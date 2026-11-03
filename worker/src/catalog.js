// Odczyt i zapis cennika. Cala logika danych jest tutaj, trasy tylko ja wolaja.
export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

// ---------- walidacja ----------
function str(v, field, { max = 80, required = true } = {}) {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (required && !s) throw bad(`Pole „${field}” jest wymagane`);
  if (s.length > max) throw bad(`Pole „${field}” może mieć max. ${max} znaków`);
  return s;
}

function int(v, field, { min = 1, max = 1_000_000 } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`Pole „${field}” musi być liczbą całkowitą ${min}–${max}`);
  return n;
}

// Ikona: '' (auto z nazwy), 'mc:Nazwa_Przedmiotu' (Minecraft Wiki) albo https://...
function icon(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (/^mc:[A-Za-z0-9_'()\-]{1,64}$/.test(s)) return s;
  if (/^https:\/\/[^\s"'<>]{4,500}$/.test(s)) return s;
  throw bad('Ikona musi być w formacie mc:Nazwa_Przedmiotu albo adresem https://');
}

function prices(list) {
  if (!Array.isArray(list) || list.length === 0) throw bad('Podaj przynajmniej jedną cenę');
  if (list.length > 10) throw bad('Max. 10 przedmiotów w cenie');
  const seen = new Set();
  return list.map((p) => {
    const currency = str(p?.currency, 'Przedmiot, którym płacimy', { max: 60 });
    const key = currency.toLowerCase();
    if (seen.has(key)) throw bad(`„${currency}” jest w cenie dwa razy`);
    seen.add(key);
    return { currency, amount: int(p?.amount, 'Ilość') };
  });
}

async function categoryId(db, v) {
  if (v === null || v === undefined || v === '') return null;
  const id = int(v, 'Kategoria');
  if (!(await db.prepare('SELECT 1 FROM categories WHERE id = ?').bind(id).first())) throw bad('Nie ma takiej kategorii');
  return id;
}

async function unique(promise, msg) {
  try { return await promise; } catch (e) {
    if (String(e?.message).includes('UNIQUE')) throw bad(msg);
    throw e;
  }
}

// ---------- odczyt ----------
export async function getCatalog(db, { includeHidden = false } = {}) {
  const vis = includeHidden ? '' : 'WHERE visible = 1';
  const [cats, items, itemPrices, bundles, bundleItems, bundlePrices, shop, enchants, enchantPrices] = await db.batch([
    db.prepare('SELECT id, name, icon, sort FROM categories ORDER BY sort, name'),
    db.prepare(`SELECT id, name, icon, category_id, note, visible, sort, updated_at FROM items ${vis} ORDER BY sort, name`),
    db.prepare('SELECT item_id, currency, amount FROM item_prices ORDER BY sort, id'),
    db.prepare(`SELECT id, name, description, icon, visible, sort FROM bundles ${vis} ORDER BY sort, id`),
    db.prepare(`SELECT bi.bundle_id, bi.item_id, bi.qty, i.name FROM bundle_items bi JOIN items i ON i.id = bi.item_id ORDER BY i.sort, i.name`),
    db.prepare('SELECT bundle_id, currency, amount FROM bundle_prices ORDER BY sort, id'),
    db.prepare("SELECT value FROM settings WHERE key = 'shop_name'"),
    db.prepare(`SELECT id, name, max_level, book, item_ids, note, visible, sort FROM enchants ${vis} ORDER BY sort, name`),
    db.prepare('SELECT enchant_id, currency, amount FROM enchant_prices ORDER BY sort, id'),
  ]);

  const byItem = new Map();
  for (const p of itemPrices.results) {
    if (!byItem.has(p.item_id)) byItem.set(p.item_id, []);
    byItem.get(p.item_id).push({ currency: p.currency, amount: p.amount });
  }
  return {
    shopName: shop.results[0]?.value || 'Minecraft Trade Shop',
    categories: cats.results,
    items: items.results.map((i) => ({ ...i, visible: !!i.visible, prices: byItem.get(i.id) || [] })),
    bundles: bundles.results.map((b) => ({
      ...b,
      visible: !!b.visible,
      items: bundleItems.results.filter((x) => x.bundle_id === b.id).map(({ item_id, qty, name }) => ({ item_id, qty, name })),
      prices: bundlePrices.results.filter((x) => x.bundle_id === b.id).map(({ currency, amount }) => ({ currency, amount })),
    })).filter((b) => includeHidden || b.items.length > 0), // pusty zestaw (usuniete przedmioty) nie trafia do cennika
    enchants: enchants.results.map((e) => ({
      id: e.id, name: e.name, maxLevel: e.max_level, book: !!e.book, note: e.note, visible: !!e.visible, sort: e.sort,
      itemIds: JSON.parse(e.item_ids || '[]'),
      prices: enchantPrices.results.filter((p) => p.enchant_id === e.id).map(({ currency, amount }) => ({ currency, amount })),
    })),
  };
}

// ---------- przedmioty ----------
export async function saveItem(db, id, body) {
  const d = {
    name: str(body.name, 'Nazwa przedmiotu', { max: 60 }),
    icon: icon(body.icon),
    category_id: await categoryId(db, body.category_id),
    note: str(body.note, 'Opis', { max: 200, required: false }),
    visible: body.visible === false ? 0 : 1,
    prices: prices(body.prices),
  };
  if (d.prices.some((p) => p.currency.toLowerCase() === d.name.toLowerCase())) throw bad('Przedmiot nie może kosztować samego siebie');

  const stmts = [];
  // id przedmiotu po nazwie, zeby nowy przedmiot i jego ceny zapisaly sie w jednej transakcji
  const itemRef = '(SELECT id FROM items WHERE name = ? COLLATE NOCASE)';
  if (id) {
    const old = await db.prepare('SELECT name FROM items WHERE id = ?').bind(id).first();
    if (!old) throw new HttpError(404, 'Nie ma takiego przedmiotu');
    stmts.push(db.prepare(`UPDATE items SET name = ?, icon = ?, category_id = ?, note = ?, visible = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(d.name, d.icon, d.category_id, d.note, d.visible, id));
    // Zmiana nazwy: przepinamy ceny innych przedmiotow, ktore placily tym przedmiotem
    if (old.name !== d.name) {
      stmts.push(db.prepare('UPDATE item_prices SET currency = ? WHERE currency = ? COLLATE NOCASE').bind(d.name, old.name));
      stmts.push(db.prepare('UPDATE bundle_prices SET currency = ? WHERE currency = ? COLLATE NOCASE').bind(d.name, old.name));
    }
    stmts.push(db.prepare('DELETE FROM item_prices WHERE item_id = ?').bind(id));
  } else {
    stmts.push(db.prepare(`INSERT INTO items (name, icon, category_id, note, visible, sort)
      VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM items))`).bind(d.name, d.icon, d.category_id, d.note, d.visible));
  }
  d.prices.forEach((p, i) =>
    stmts.push(db.prepare(`INSERT INTO item_prices (item_id, currency, amount, sort) VALUES (${itemRef}, ?, ?, ?)`).bind(d.name, p.currency, p.amount, i)));
  await unique(db.batch(stmts), 'Przedmiot o takiej nazwie już istnieje');
  return id || (await db.prepare('SELECT id FROM items WHERE name = ? COLLATE NOCASE').bind(d.name).first()).id;
}

export async function deleteItem(db, id) {
  return (await db.prepare('DELETE FROM items WHERE id = ?').bind(id).run()).meta.changes > 0;
}

// ---------- kategorie ----------
export async function saveCategory(db, id, body) {
  const name = str(body.name, 'Nazwa kategorii', { max: 40 });
  const ic = icon(body.icon);
  const msg = 'Kategoria o takiej nazwie już istnieje';
  if (id) {
    const r = await unique(db.prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ?').bind(name, ic, id).run(), msg);
    if (!r.meta.changes) throw new HttpError(404, 'Nie ma takiej kategorii');
    return id;
  }
  const row = await unique(db.prepare(`INSERT INTO categories (name, icon, sort)
    VALUES (?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM categories)) RETURNING id`).bind(name, ic).first(), msg);
  return row.id;
}

export async function deleteCategory(db, id) {
  return (await db.prepare('DELETE FROM categories WHERE id = ?').bind(id).run()).meta.changes > 0;
}

// ---------- zestawy / rabaty ----------
export async function saveBundle(db, id, body) {
  const name = str(body.name, 'Nazwa zestawu', { max: 60 });
  const description = str(body.description, 'Opis', { max: 300, required: false });
  const ic = icon(body.icon);
  const visible = body.visible === false ? 0 : 1;
  const bp = prices(body.prices);
  if (!Array.isArray(body.items) || body.items.length < 1) throw bad('Zestaw musi mieć przynajmniej 1 przedmiot');
  if (body.items.length > 50) throw bad('Za dużo przedmiotów w zestawie');
  const seen = new Set();
  const its = body.items.map((x) => {
    const itemId = int(x?.item_id, 'Przedmiot zestawu');
    if (seen.has(itemId)) throw bad('Przedmiot jest w zestawie dwa razy');
    seen.add(itemId);
    return { item_id: itemId, qty: int(x?.qty ?? 1, 'Ilość w zestawie', { max: 999 }) };
  });
  const found = await db.prepare(`SELECT COUNT(*) AS c FROM items WHERE id IN (${its.map(() => '?').join(',')})`).bind(...its.map((x) => x.item_id)).first();
  if (found.c !== its.length) throw bad('Nie ma takiego przedmiotu w zestawie');

  let created = false;
  if (id) {
    const r = await db.prepare('UPDATE bundles SET name = ?, description = ?, icon = ?, visible = ? WHERE id = ?').bind(name, description, ic, visible, id).run();
    if (!r.meta.changes) throw new HttpError(404, 'Nie ma takiego zestawu');
  } else {
    id = (await db.prepare(`INSERT INTO bundles (name, description, icon, visible, sort)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM bundles)) RETURNING id`).bind(name, description, ic, visible).first()).id;
    created = true;
  }
  try {
    await db.batch([
      db.prepare('DELETE FROM bundle_items WHERE bundle_id = ?').bind(id),
      db.prepare('DELETE FROM bundle_prices WHERE bundle_id = ?').bind(id),
      ...its.map((x) => db.prepare('INSERT INTO bundle_items (bundle_id, item_id, qty) VALUES (?, ?, ?)').bind(id, x.item_id, x.qty)),
      ...bp.map((p, i) => db.prepare('INSERT INTO bundle_prices (bundle_id, currency, amount, sort) VALUES (?, ?, ?, ?)').bind(id, p.currency, p.amount, i)),
    ]);
  } catch (e) {
    if (created) await db.prepare('DELETE FROM bundles WHERE id = ?').bind(id).run();
    throw e;
  }
  return id;
}

export async function deleteBundle(db, id) {
  return (await db.prepare('DELETE FROM bundles WHERE id = ?').bind(id).run()).meta.changes > 0;
}

// ---------- enchanty ----------
export async function saveEnchant(db, id, body) {
  const name = str(body.name, 'Nazwa enchantu', { max: 40 });
  const maxLevel = int(body.maxLevel, 'Maks. poziom', { max: 10 });
  const note = str(body.note, 'Opis', { max: 200, required: false });
  const ep = prices(body.prices);
  const book = body.book === false ? 0 : 1;
  const visible = body.visible === false ? 0 : 1;
  const itemIds = [...new Set((Array.isArray(body.itemIds) ? body.itemIds : []).map((v) => int(v, 'Przedmiot')))];
  if (itemIds.length) {
    const found = await db.prepare(`SELECT COUNT(*) AS c FROM items WHERE id IN (${itemIds.map(() => '?').join(',')})`).bind(...itemIds).first();
    if (found.c !== itemIds.length) throw bad('Nie ma takiego przedmiotu');
  }
  if (!book && !itemIds.length) throw bad('Zaznacz przedmioty albo „można kupić jako księgę”');
  const ref = '(SELECT id FROM enchants WHERE name = ? COLLATE NOCASE)';
  const stmts = [];
  if (id) {
    if (!(await db.prepare('SELECT 1 FROM enchants WHERE id = ?').bind(id).first())) throw new HttpError(404, 'Nie ma takiego enchantu');
    stmts.push(db.prepare('UPDATE enchants SET name = ?, max_level = ?, book = ?, item_ids = ?, note = ?, visible = ? WHERE id = ?')
      .bind(name, maxLevel, book, JSON.stringify(itemIds), note, visible, id));
    stmts.push(db.prepare('DELETE FROM enchant_prices WHERE enchant_id = ?').bind(id));
  } else {
    stmts.push(db.prepare(`INSERT INTO enchants (name, max_level, book, item_ids, note, visible, sort)
      VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM enchants))`).bind(name, maxLevel, book, JSON.stringify(itemIds), note, visible));
  }
  ep.forEach((p, i) => stmts.push(db.prepare(`INSERT INTO enchant_prices (enchant_id, currency, amount, sort) VALUES (${ref}, ?, ?, ?)`).bind(name, p.currency, p.amount, i)));
  await unique(db.batch(stmts), 'Enchant o takiej nazwie już istnieje');
  return id || (await db.prepare('SELECT id FROM enchants WHERE name = ? COLLATE NOCASE').bind(name).first()).id;
}

export async function deleteEnchant(db, id) {
  return (await db.prepare('DELETE FROM enchants WHERE id = ?').bind(id).run()).meta.changes > 0;
}

// ---------- ustawienia ----------
export async function saveSettings(db, body) {
  const values = { shop_name: str(body.shopName, 'Nazwa sklepu', { max: 60 }) };
  if (body.expressEnabled !== undefined) values.express_enabled = body.expressEnabled ? '1' : '0';
  if (body.expressFee !== undefined) {
    values.express_fee_amount = String(int(body.expressFee?.amount, 'Dopłata za natychmiastową dostawę', { max: 100_000 }));
    values.express_fee_currency = str(body.expressFee?.currency, 'Przedmiot dopłaty', { max: 60 });
  }
  if (body.aiEnabled !== undefined) values.ai_enabled = body.aiEnabled ? '1' : '0';
  await db.batch(Object.entries(values).map(([k, v]) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)));
}
