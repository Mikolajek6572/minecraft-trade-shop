// Zamowienia: klient sklada je ze strony (z nickiem), admin zmienia status
import { HttpError } from './catalog.js';
import { getSettings, expressFeeList, rateLimit, validNick, text, sumPrices } from './shop.js';
import { conversationFromRequest, addSystemMessage } from './chat.js';

export const STATUSES = { new: 'Nowe', in_progress: 'W realizacji', done: 'Zrealizowane', cancelled: 'Anulowane' };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const lineName = (l) => l.enchants?.length ? `${l.name} (${l.enchants.map((e) => (e.maxLevel === 1 ? e.name : `${e.name} ${ROMAN[e.level] || e.level}`)).join(', ')})` : l.name;

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

function view(o, { admin = false } = {}) {
  const v = {
    code: o.code,
    nick: o.nick,
    status: o.status,
    lines: JSON.parse(o.lines_json),
    total: JSON.parse(o.total_json),
    express: !!o.express,
    expressFee: JSON.parse(o.express_fee_json),
    customerNote: o.customer_note,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
  if (admin) Object.assign(v, { id: o.id, adminNote: o.admin_note, conversationId: o.conversation_id });
  return v;
}

export async function createOrder(env, request, body, clientIp) {
  const db = env.DB;
  await rateLimit(db, `order:${clientIp}`, 10, 3600_000, 'Za dużo zamówień z rzędu. Spróbuj za godzinę');
  const nick = validNick(body.nick);
  const note = text(body.note, 'Uwagi', 300);

  if (!Array.isArray(body.lines) || body.lines.length === 0) throw new HttpError(400, 'Koszyk jest pusty');
  if (body.lines.length > 30) throw new HttpError(400, 'Max. 30 pozycji w zamówieniu');
  const wanted = new Map();
  for (const l of body.lines) {
    const type = l?.type === 'bundle' || l?.type === 'book' ? l.type : 'item';
    const id = type === 'book' ? 0 : Number(l?.id), qty = Number(l?.qty);
    if (type !== 'book' && (!Number.isInteger(id) || id < 1)) throw new HttpError(400, 'Zła pozycja w koszyku');
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new HttpError(400, 'Ilość musi być od 1 do 999');
    const ench = (Array.isArray(l?.ench) ? l.ench : []).map((e) => ({ id: Number(e?.id), level: Number(e?.level) }));
    if (ench.length > 12) throw new HttpError(400, 'Za dużo enchantów na jednym przedmiocie');
    if (ench.some((e) => !Number.isInteger(e.id) || !Number.isInteger(e.level) || e.level < 1)) throw new HttpError(400, 'Zły enchant');
    if (new Set(ench.map((e) => e.id)).size !== ench.length) throw new HttpError(400, 'Ten sam enchant jest dwa razy');
    if (type === 'bundle' && ench.length) throw new HttpError(400, 'Do zestawu nie da się dodać enchantów');
    if (type === 'book' && !ench.length) throw new HttpError(400, 'Księga musi mieć przynajmniej 1 enchant');
    ench.sort((x, y) => x.id - y.id);
    const k = `${type}:${id}:${ench.map((e) => `${e.id}.${e.level}`).join(',')}`;
    wanted.set(k, { type, id, ench, qty: Math.min(999, (wanted.get(k)?.qty || 0) + qty) });
  }

  // Ceny zawsze z bazy, nie z przegladarki
  const itemIds = [...wanted.values()].filter((w) => w.type === 'item').map((w) => w.id);
  const bundleIds = [...wanted.values()].filter((w) => w.type === 'bundle').map((w) => w.id);
  const ph = (a) => a.map(() => '?').join(',') || 'NULL';
  const [items, itemPrices, bundles, bundlePrices, enchants, enchantPrices] = await db.batch([
    db.prepare(`SELECT id, name FROM items WHERE visible = 1 AND id IN (${ph(itemIds)})`).bind(...itemIds),
    db.prepare(`SELECT item_id, currency, amount FROM item_prices WHERE item_id IN (${ph(itemIds)}) ORDER BY sort, id`).bind(...itemIds),
    db.prepare(`SELECT id, name FROM bundles WHERE visible = 1 AND id IN (${ph(bundleIds)})`).bind(...bundleIds),
    db.prepare(`SELECT bundle_id, currency, amount FROM bundle_prices WHERE bundle_id IN (${ph(bundleIds)}) ORDER BY sort, id`).bind(...bundleIds),
    db.prepare('SELECT id, name, max_level, book, item_ids FROM enchants WHERE visible = 1'),
    db.prepare('SELECT enchant_id, currency, amount FROM enchant_prices ORDER BY sort, id'),
  ]);

  const lines = [];
  for (const w of wanted.values()) {
    let name, base;
    if (w.type === 'book') {
      name = 'Enchanted Book';
      base = [];
    } else {
      const src = w.type === 'item' ? items.results.find((i) => i.id === w.id) : bundles.results.find((b) => b.id === w.id);
      if (!src) throw new HttpError(400, 'Coś z koszyka nie jest już w ofercie. Odśwież stronę');
      name = src.name;
      base = (w.type === 'item'
        ? itemPrices.results.filter((p) => p.item_id === w.id)
        : bundlePrices.results.filter((p) => p.bundle_id === w.id)).map(({ currency, amount }) => ({ currency, amount }));
    }
    const enchList = [];
    const parts = [{ prices: base, qty: 1 }];
    for (const e of w.ench) {
      const en = enchants.results.find((x) => x.id === e.id);
      if (!en) throw new HttpError(400, 'Jakiś enchant nie jest już w ofercie. Odśwież stronę');
      if (e.level > en.max_level) throw new HttpError(400, `${en.name} ma maks. poziom ${en.max_level}`);
      if (w.type === 'book' ? !en.book : !JSON.parse(en.item_ids).includes(w.id)) throw new HttpError(400, `${en.name} nie pasuje do: ${name}`);
      enchList.push({ name: en.name, level: e.level, maxLevel: en.max_level });
      parts.push({ prices: enchantPrices.results.filter((p) => p.enchant_id === e.id), qty: e.level });
    }
    lines.push({ type: w.type, id: w.id, name, qty: w.qty, prices: sumPrices(parts), ...(enchList.length ? { enchants: enchList } : {}) });
  }

  const settings = await getSettings(db);
  const express = body.express === true;
  if (express && !settings.expressEnabled) throw new HttpError(400, 'Natychmiastowa dostawa jest teraz wyłączona');
  const fee = express ? expressFeeList(settings) : [];
  const total = sumPrices([...lines, { prices: fee, qty: 1 }]);

  const conv = await conversationFromRequest(db, request);
  const now = Date.now();
  let code;
  for (let i = 0; i < 5 && !code; i++) {
    const c = newCode();
    if (!(await db.prepare('SELECT 1 FROM orders WHERE code = ?').bind(c).first())) code = c;
  }
  const row = await db.prepare(`INSERT INTO orders (code, nick, lines_json, total_json, express, express_fee_json, customer_note, conversation_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
    .bind(code, nick, JSON.stringify(lines), JSON.stringify(total), express ? 1 : 0, JSON.stringify(fee), note, conv?.id ?? null, now, now).first();

  if (conv) await addSystemMessage(db, conv.id, `Złożono zamówienie #${code}${express ? ' (NATYCHMIASTOWA DOSTAWA)' : ''}: ${lines.map((l) => `${l.qty}× ${lineName(l)}`).join(', ')}`);
  return view(row);
}

export async function getOrder(db, code) {
  if (!/^[A-Z0-9]{8}$/.test(String(code))) throw new HttpError(400, 'Zły numer zamówienia');
  const o = await db.prepare('SELECT * FROM orders WHERE code = ?').bind(code).first();
  if (!o) throw new HttpError(404, 'Nie ma takiego zamówienia');
  return view(o);
}

// ---------- admin ----------
export async function listOrders(db, status) {
  const where = STATUSES[status] ? 'WHERE status = ?' : '';
  const stmt = db.prepare(`SELECT * FROM orders ${where} ORDER BY
    CASE status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, express DESC, created_at DESC LIMIT 300`);
  const { results } = await (where ? stmt.bind(status) : stmt).all();
  return results.map((o) => view(o, { admin: true }));
}

export async function ordersForNick(db, nick) {
  const { results } = await db.prepare('SELECT * FROM orders WHERE nick = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT 20').bind(nick).all();
  return results.map((o) => view(o, { admin: true }));
}

export async function updateOrder(db, id, body) {
  const o = await db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o) throw new HttpError(404, 'Nie ma takiego zamówienia');
  const status = body.status === undefined ? o.status : body.status;
  if (!STATUSES[status]) throw new HttpError(400, 'Zły status');
  const adminNote = body.adminNote === undefined ? o.admin_note : text(body.adminNote, 'Notatka', 500);
  await db.prepare('UPDATE orders SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?').bind(status, adminNote, Date.now(), id).run();
  if (status !== o.status && o.conversation_id)
    await addSystemMessage(db, o.conversation_id, `Zamówienie #${o.code}: ${STATUSES[status]}`);
  return true;
}

export async function deleteOrder(db, id) {
  return (await db.prepare('DELETE FROM orders WHERE id = ?').bind(id).run()).meta.changes > 0;
}

export async function orderStats(db) {
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const [counts, today, recent] = await db.batch([
    db.prepare('SELECT status, COUNT(*) AS c, SUM(express) AS e FROM orders GROUP BY status'),
    db.prepare("SELECT COUNT(*) AS c FROM orders WHERE created_at >= ?").bind(dayStart.getTime()),
    db.prepare("SELECT lines_json FROM orders WHERE status != 'cancelled' ORDER BY created_at DESC LIMIT 500"),
  ]);
  const byStatus = Object.fromEntries(Object.keys(STATUSES).map((k) => [k, 0]));
  let expressOpen = 0;
  for (const r of counts.results) {
    byStatus[r.status] = r.c;
    if (r.status === 'new' || r.status === 'in_progress') expressOpen += r.e || 0;
  }
  const top = new Map();
  for (const r of recent.results) for (const l of JSON.parse(r.lines_json)) top.set(l.name, (top.get(l.name) || 0) + l.qty);
  return {
    byStatus,
    expressOpen,
    today: today.results[0].c,
    top: [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty })),
  };
}
