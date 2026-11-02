// Panel administratora
(() => {
  const { esc, iconHtml, api, token, priceText, toast } = MTS;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const ICONS = {
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  };

  let data = { categories: [], items: [], bundles: [], shopName: '' };

  // ---------- logowanie ----------
  async function boot() {
    if (!token.get()) return showLogin();
    try {
      const me = await api('/api/auth/me');
      showApp(me.username);
    } catch (e) {
      if (e.status === 401) token.clear();
      showLogin();
    }
  }

  function showLogin() {
    $('#appView').hidden = true;
    $('#loginView').hidden = false;
    $('#loginForm [name=username]').focus();
  }

  async function showApp(username) {
    $('#loginView').hidden = true;
    $('#appView').hidden = false;
    $('#whoami').textContent = `Zalogowany: ${username}`;
    await reload();
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    $('#loginError').textContent = '';
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } });
      token.set(r.token);
      f.reset();
      showApp(r.username);
    } catch (err) {
      $('#loginError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    token.clear();
    showLogin();
  });

  // Kazdy blad 401 = sesja wygasla
  async function call(url, opts) {
    try {
      return await api(url, opts);
    } catch (e) {
      if (e.status === 401) { token.clear(); toast('Sesja wygasła – zaloguj się ponownie', 'err'); showLogin(); }
      throw e;
    }
  }

  async function reload() {
    data = await call('/api/admin/catalog');
    renderAll();
  }

  // ---------- zakladki ----------
  $('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${t.dataset.tab}`; });
  });

  function renderAll() {
    renderCategoryOptions();
    renderItems();
    renderBundles();
    renderCategories();
    $('#settingsForm').shopName.value = data.shopName;
    $('#itemNames').innerHTML = [...new Set([...data.items.map((i) => i.name), ...data.items.flatMap((i) => i.prices.map((p) => p.currency))])]
      .sort().map((n) => `<option value="${esc(n)}">`).join('');
  }

  const catName = (id) => data.categories.find((c) => c.id === id)?.name || '';
  const itemIcon = (name) => data.items.find((i) => i.name.toLowerCase() === String(name).toLowerCase())?.icon || '';

  function renderCategoryOptions() {
    const opts = data.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const f = $('#itemCatFilter');
    const keep = f.value;
    f.innerHTML = `<option value="">Wszystkie kategorie</option>${opts}<option value="none">Bez kategorii</option>`;
    f.value = [...f.options].some((o) => o.value === keep) ? keep : '';
    $('#itemCategory').innerHTML = `<option value="">— bez kategorii —</option>${opts}`;
  }

  // ---------- przedmioty ----------
  function renderItems() {
    const q = $('#itemSearch').value.trim().toLowerCase();
    const cat = $('#itemCatFilter').value;
    const list = data.items.filter((i) =>
      (!q || i.name.toLowerCase().includes(q) || i.prices.some((p) => p.currency.toLowerCase().includes(q)))
      && (!cat || (cat === 'none' ? !i.category_id : String(i.category_id) === cat)));
    $('#itemEmpty').hidden = list.length > 0;
    $('#itemRows').innerHTML = list.map((i) => `
      <tr class="${i.visible ? '' : 'hidden-row'}" data-id="${i.id}">
        <td><div class="icon-slot">${iconHtml(i.icon, i.name)}</div></td>
        <td class="name">${esc(i.name)}</td>
        <td class="muted">${esc(catName(i.category_id)) || '—'}</td>
        <td>${esc(priceText(i.prices))}</td>
        <td><label class="switch" title="Widoczny w cenniku"><input type="checkbox" data-act="toggle" ${i.visible ? 'checked' : ''}><span></span></label></td>
        <td><div class="row-actions">
          <button class="icon-btn" data-act="edit" title="Edytuj" aria-label="Edytuj ${esc(i.name)}">${ICONS.edit}</button>
          <button class="icon-btn danger" data-act="delete" title="Usuń" aria-label="Usuń ${esc(i.name)}">${ICONS.trash}</button>
        </div></td>
      </tr>`).join('');
  }

  $('#itemSearch').addEventListener('input', renderItems);
  $('#itemCatFilter').addEventListener('change', renderItems);
  $('#addItemBtn').addEventListener('click', () => openItem(null));

  $('#itemRows').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.dataset.act === 'toggle') return;
    const item = data.items.find((i) => i.id === Number(btn.closest('tr').dataset.id));
    if (btn.dataset.act === 'edit') openItem(item);
    if (btn.dataset.act === 'delete') {
      const used = data.items.filter((i) => i.prices.some((p) => p.currency.toLowerCase() === item.name.toLowerCase()));
      const warn = used.length ? `\n\nUwaga: ${used.length} innych przedmiotów ma cenę w "${item.name}" – te ceny zostaną bez zmian.` : '';
      if (!confirm(`Usunąć "${item.name}"?${warn}`)) return;
      try {
        await call(`/api/admin/items/${item.id}`, { method: 'DELETE' });
        toast(`Usunięto ${item.name}`);
        reload();
      } catch (err) { toast(err.message, 'err'); }
    }
  });

  $('#itemRows').addEventListener('change', async (e) => {
    if (e.target.dataset.act !== 'toggle') return;
    const item = data.items.find((i) => i.id === Number(e.target.closest('tr').dataset.id));
    try {
      await call(`/api/admin/items/${item.id}`, { method: 'PUT', body: { ...item, visible: e.target.checked } });
      toast(e.target.checked ? `${item.name} jest widoczny` : `${item.name} ukryty`);
      reload();
    } catch (err) { toast(err.message, 'err'); e.target.checked = !e.target.checked; }
  });

  // Wiersz ceny: ilosc × przedmiot
  function priceRow(p = { amount: 1, currency: '' }) {
    const row = document.createElement('div');
    row.className = 'price-row';
    row.innerHTML = `
      <input type="number" min="1" max="1000000" step="1" value="${esc(p.amount)}" aria-label="Ilość" required>
      <span class="times">×</span>
      <span class="cur-icon">${iconHtml(itemIcon(p.currency), p.currency || '?', 'sm')}</span>
      <input class="grow" list="itemNames" maxlength="60" value="${esc(p.currency)}" placeholder="Przedmiot, którym płacimy" aria-label="Przedmiot, którym płacimy" required>
      <button type="button" class="icon-btn danger" data-remove aria-label="Usuń z ceny">${ICONS.x}</button>`;
    const cur = $$('input', row)[1];
    cur.addEventListener('change', () => { $('.cur-icon', row).innerHTML = iconHtml(itemIcon(cur.value), cur.value || '?', 'sm'); });
    return row;
  }

  function readPrices(container) {
    return $$('.price-row', container).map((r) => {
      const [amount, currency] = $$('input', r);
      return { amount: Number(amount.value), currency: currency.value.trim() };
    });
  }

  // Usuwanie wierszy i dodawanie cen w oknach
  document.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const rows = rm.closest('.price-rows');
      if (rows.children.length > 1) rm.closest('.price-row').remove();
      else toast('Musi zostać przynajmniej jedna pozycja', 'err');
      rows.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const add = e.target.closest('.add-price');
    if (add) {
      const rows = $('.price-rows', add.closest('fieldset'));
      if (rows.children.length >= 10) return toast('Max 10 przedmiotów w cenie', 'err');
      const row = priceRow();
      rows.append(row);
      $$('input', row)[1].focus();
    }
    if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
  });

  function iconPreview(input, target, nameFn) {
    const upd = () => { target.innerHTML = iconHtml(input.value.trim(), nameFn()); };
    input.addEventListener('input', upd);
    return upd;
  }

  const itemForm = $('#itemForm');
  let editingItem = null;
  const updItemIcon = iconPreview(itemForm.icon, $('#itemIconPreview'), () => itemForm.name.value || '?');
  itemForm.name.addEventListener('input', updItemIcon);

  function openItem(item) {
    editingItem = item;
    $('#itemDialogTitle').textContent = item ? `Edytuj: ${item.name}` : 'Dodaj przedmiot';
    itemForm.reset();
    itemForm.name.value = item?.name || '';
    itemForm.icon.value = item?.icon || '';
    itemForm.category_id.value = item?.category_id ?? ($('#itemCatFilter').value !== 'none' ? $('#itemCatFilter').value : '');
    itemForm.note.value = item?.note || '';
    itemForm.visible.checked = item ? item.visible : true;
    $('#itemPrices').replaceChildren(...(item?.prices.length ? item.prices : [{ amount: 1, currency: '' }]).map(priceRow));
    $('.form-error', itemForm).textContent = '';
    updItemIcon();
    $('#itemDialog').showModal();
    itemForm.name.focus();
  }

  itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: itemForm.name.value,
      icon: itemForm.icon.value,
      category_id: itemForm.category_id.value || null,
      note: itemForm.note.value,
      visible: itemForm.visible.checked,
      prices: readPrices($('#itemPrices')),
    };
    try {
      if (editingItem) await call(`/api/admin/items/${editingItem.id}`, { method: 'PUT', body });
      else await call('/api/admin/items', { method: 'POST', body });
      $('#itemDialog').close();
      toast(editingItem ? `Zapisano ${body.name}` : `Dodano ${body.name}`);
      reload();
    } catch (err) { $('.form-error', itemForm).textContent = err.message; }
  });

  // ---------- zestawy ----------
  function regularPrice(bundleItems) {
    const sum = new Map();
    let complete = true;
    for (const bi of bundleItems) {
      const it = data.items.find((i) => i.id === bi.item_id);
      if (!it || !it.prices.length) { complete = false; continue; }
      for (const p of it.prices) {
        const k = p.currency.toLowerCase();
        const cur = sum.get(k) || { currency: p.currency, amount: 0 };
        cur.amount += p.amount * bi.qty;
        sum.set(k, cur);
      }
    }
    return { list: [...sum.values()], complete };
  }

  function discountText(bundleItems, prices) {
    const reg = regularPrice(bundleItems);
    if (!reg.list.length) return 'Dodaj przedmioty, żeby zobaczyć rabat.';
    const parts = [];
    for (const r of reg.list) {
      const p = prices.find((x) => x.currency.toLowerCase() === r.currency.toLowerCase());
      if (p && p.amount < r.amount) parts.push(`<span class="good">−${r.amount - p.amount} ${esc(r.currency)}</span>`);
      if (p && p.amount > r.amount) parts.push(`<span class="muted">drożej o ${p.amount - r.amount} ${esc(r.currency)}</span>`);
    }
    return `Osobno: <b>${esc(priceText(reg.list))}</b> · Zestaw: <b>${esc(priceText(prices.filter((p) => p.currency && p.amount > 0))) || '—'}</b>${parts.length ? ` · Rabat: ${parts.join(', ')}` : ''}`;
  }

  function renderBundles() {
    $('#bundleList').innerHTML = data.bundles.length ? data.bundles.map((b) => `
      <article class="admin-card ${b.visible ? '' : 'is-hidden'}" data-id="${b.id}">
        <div class="admin-card-head">
          <div class="icon-slot">${iconHtml(b.icon, b.items[0]?.name || b.name)}</div>
          <h3>${esc(b.name)}${b.visible ? '' : ' <span class="muted small">(ukryty)</span>'}</h3>
          <div class="row-actions">
            <button class="icon-btn" data-act="edit" aria-label="Edytuj">${ICONS.edit}</button>
            <button class="icon-btn danger" data-act="delete" aria-label="Usuń">${ICONS.trash}</button>
          </div>
        </div>
        <ul>${b.items.map((i) => `<li>${i.qty > 1 ? `${i.qty}× ` : ''}${esc(i.name)}</li>`).join('')}</ul>
        <div class="discount-preview">${discountText(b.items, b.prices)}</div>
      </article>`).join('') : '<p class="empty">Brak zestawów. Dodaj pierwszy!</p>';
  }

  $('#bundleList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const b = data.bundles.find((x) => x.id === Number(btn.closest('[data-id]').dataset.id));
    if (btn.dataset.act === 'edit') openBundle(b);
    if (btn.dataset.act === 'delete' && confirm(`Usunąć zestaw "${b.name}"?`)) {
      try {
        await call(`/api/admin/bundles/${b.id}`, { method: 'DELETE' });
        toast('Usunięto zestaw');
        reload();
      } catch (err) { toast(err.message, 'err'); }
    }
  });

  function bundleItemRow(bi = { item_id: '', qty: 1 }) {
    const row = document.createElement('div');
    row.className = 'price-row';
    row.innerHTML = `
      <input type="number" min="1" max="999" step="1" value="${esc(bi.qty)}" aria-label="Ilość" required>
      <span class="times">×</span>
      <select aria-label="Przedmiot" required>
        <option value="">— wybierz przedmiot —</option>
        ${data.items.map((i) => `<option value="${i.id}" ${i.id === bi.item_id ? 'selected' : ''}>${esc(i.name)}${i.prices.length ? ` (${esc(priceText(i.prices))})` : ''}</option>`).join('')}
      </select>
      <button type="button" class="icon-btn danger" data-remove aria-label="Usuń z zestawu">${ICONS.x}</button>`;
    return row;
  }

  const bundleForm = $('#bundleForm');
  let editingBundle = null;
  const readBundleItems = () => $$('#bundleItems .price-row').map((r) => ({ qty: Number($('input', r).value), item_id: Number($('select', r).value) }))
    .filter((x) => x.item_id);
  const updBundleSummary = () => { $('#bundleSummary').innerHTML = discountText(readBundleItems(), readPrices($('#bundlePrices'))); };
  const updBundleIcon = iconPreview(bundleForm.icon, $('#bundleIconPreview'), () => {
    const first = readBundleItems()[0];
    return data.items.find((i) => i.id === first?.item_id)?.name || bundleForm.name.value || '?';
  });
  bundleForm.addEventListener('input', () => { updBundleSummary(); updBundleIcon(); });
  bundleForm.addEventListener('change', () => { updBundleSummary(); updBundleIcon(); });
  $('#addBundleItem').addEventListener('click', () => { $('#bundleItems').append(bundleItemRow()); updBundleSummary(); });
  $('#addBundleBtn').addEventListener('click', () => openBundle(null));

  function openBundle(b) {
    editingBundle = b;
    $('#bundleDialogTitle').textContent = b ? `Edytuj: ${b.name}` : 'Dodaj zestaw / rabat';
    bundleForm.reset();
    bundleForm.name.value = b?.name || '';
    bundleForm.description.value = b?.description || '';
    bundleForm.icon.value = b?.icon || '';
    bundleForm.visible.checked = b ? b.visible : true;
    $('#bundleItems').replaceChildren(...(b?.items.length ? b.items : [{ item_id: '', qty: 1 }]).map(bundleItemRow));
    $('#bundlePrices').replaceChildren(...(b?.prices.length ? b.prices : [{ amount: 1, currency: '' }]).map(priceRow));
    $('.form-error', bundleForm).textContent = '';
    updBundleSummary();
    updBundleIcon();
    $('#bundleDialog').showModal();
    bundleForm.name.focus();
  }

  bundleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      name: bundleForm.name.value,
      description: bundleForm.description.value,
      icon: bundleForm.icon.value,
      visible: bundleForm.visible.checked,
      items: readBundleItems(),
      prices: readPrices($('#bundlePrices')),
    };
    try {
      if (editingBundle) await call(`/api/admin/bundles/${editingBundle.id}`, { method: 'PUT', body });
      else await call('/api/admin/bundles', { method: 'POST', body });
      $('#bundleDialog').close();
      toast('Zapisano zestaw');
      reload();
    } catch (err) { $('.form-error', bundleForm).textContent = err.message; }
  });

  // ---------- kategorie ----------
  function renderCategories() {
    $('#catList').innerHTML = data.categories.length ? data.categories.map((c) => `
      <form class="cat-row" data-id="${c.id}">
        <div class="icon-slot">${c.icon ? iconHtml(c.icon, c.name) : `<span class="mc-icon-ph" data-ph="${esc(c.name.slice(0, 2).toUpperCase())}"></span>`}</div>
        <input name="name" value="${esc(c.name)}" maxlength="40" required aria-label="Nazwa kategorii">
        <input name="icon" value="${esc(c.icon)}" maxlength="500" placeholder="Ikona, np. mc:Diamond" aria-label="Ikona kategorii">
        <span class="count">${data.items.filter((i) => i.category_id === c.id).length} przedm.</span>
        <button class="btn btn-ghost" type="submit">Zapisz</button>
        <button class="icon-btn danger" type="button" data-act="delete" aria-label="Usuń kategorię">${ICONS.trash}</button>
      </form>`).join('') : '<p class="empty">Brak kategorii.</p>';
  }

  $('#catForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('/api/admin/categories', { method: 'POST', body: { name: e.target.name.value, icon: e.target.icon.value } });
      toast(`Dodano kategorię ${e.target.name.value}`);
      e.target.reset();
      reload();
    } catch (err) { toast(err.message, 'err'); }
  });

  $('#catList').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await call(`/api/admin/categories/${f.dataset.id}`, { method: 'PUT', body: { name: f.name.value, icon: f.icon.value } });
      toast('Zapisano kategorię');
      reload();
    } catch (err) { toast(err.message, 'err'); }
  });

  $('#catList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act=delete]');
    if (!btn) return;
    const id = Number(btn.closest('form').dataset.id);
    const c = data.categories.find((x) => x.id === id);
    if (!confirm(`Usunąć kategorię "${c.name}"? Przedmioty zostaną, tylko bez kategorii.`)) return;
    try {
      await call(`/api/admin/categories/${id}`, { method: 'DELETE' });
      toast('Usunięto kategorię');
      reload();
    } catch (err) { toast(err.message, 'err'); }
  });

  // ---------- ustawienia ----------
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await call('/api/admin/settings', { method: 'PUT', body: { shopName: e.target.shopName.value } });
      toast('Zapisano ustawienia');
      reload();
    } catch (err) { toast(err.message, 'err'); }
  });

  $('#passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.next.value !== f.next2.value) return toast('Nowe hasła się różnią', 'err');
    try {
      await call('/api/auth/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      f.reset();
      toast('Hasło zmienione. Inne sesje zostały wylogowane');
    } catch (err) { toast(err.message, 'err'); }
  });

  boot();
})();
