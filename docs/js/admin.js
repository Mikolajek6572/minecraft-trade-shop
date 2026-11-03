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
    stopLive();
  }

  async function showApp(username) {
    $('#loginView').hidden = true;
    $('#appView').hidden = false;
    $('#whoami').textContent = `Zalogowany: ${username}`;
    await reload();
    startLive();
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
    const sf = $('#settingsForm');
    sf.shopName.value = data.shopName;
    if (data.shop && document.activeElement?.form !== sf) {
      sf.expressEnabled.checked = data.shop.expressEnabled;
      sf.expressAmount.value = data.shop.expressFee.amount;
      sf.expressCurrency.value = data.shop.expressFee.currency;
      sf.aiEnabled.checked = data.shop.aiEnabled;
    }
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
      const f = e.target;
      await call('/api/admin/settings', { method: 'PUT', body: {
        shopName: f.shopName.value,
        expressEnabled: f.expressEnabled.checked,
        expressFee: { amount: Number(f.expressAmount.value), currency: f.expressCurrency.value },
        aiEnabled: f.aiEnabled.checked,
      } });
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

  // ---------- zamowienia i czat na zywo ----------
  const STATUS = { new: 'Nowe', in_progress: 'W realizacji', done: 'Zrealizowane', cancelled: 'Anulowane' };
  let orders = [];
  let conversations = [];
  let orderFilter = 'active';
  let known = null; // co juz widzielismy, zeby wiedziec kiedy pikac
  let liveTimer = null;
  let openConvId = null;
  let convLastId = 0;

  const avatar = (nick, size = 32) => `<img class="mc-icon avatar" src="https://mc-heads.net/avatar/${encodeURIComponent(nick)}/${size}" alt="" loading="lazy" data-ph="${esc(nick.slice(0, 2).toUpperCase())}">`;
  const ago = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'przed chwilą';
    if (s < 3600) return `${Math.floor(s / 60)} min temu`;
    if (s < 86400) return `${Math.floor(s / 3600)} h temu`;
    return new Date(ts).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // Dzwiek bez plikow (Web Audio). Pilne zamowienie = trzy glosne piski
  const soundOn = () => { try { return localStorage.getItem('mts_sound') !== '0'; } catch { return true; } };
  $('#soundToggle').checked = soundOn();
  $('#soundToggle').addEventListener('change', (e) => { try { localStorage.setItem('mts_sound', e.target.checked ? '1' : '0'); } catch { /* */ } });
  let audio = null;
  function beep(urgent) {
    if (!soundOn()) return;
    try {
      audio ||= new AudioContext();
      const notes = urgent ? [1200, 800, 1200, 800, 1200] : [880, 1320];
      notes.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = urgent ? 'square' : 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(urgent ? 0.12 : 0.15, audio.currentTime + i * 0.14);
        g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + i * 0.14 + 0.13);
        o.connect(g).connect(audio.destination);
        o.start(audio.currentTime + i * 0.14);
        o.stop(audio.currentTime + i * 0.14 + 0.14);
      });
    } catch { /* brak dzwieku */ }
  }

  function startLive() {
    known = null;
    refreshLive();
    clearInterval(liveTimer);
    liveTimer = setInterval(() => {
      refreshLive();
      if (openConvId && !$('#tab-chat').hidden) loadConversation(openConvId, { quiet: true });
    }, 5000);
  }
  function stopLive() {
    clearInterval(liveTimer);
    liveTimer = null;
    openConvId = null;
  }

  async function refreshLive() {
    let inbox, list;
    try {
      [inbox, list] = await Promise.all([call('/api/admin/inbox'), call('/api/admin/orders')]);
    } catch { return; }
    const unread = inbox.conversations.reduce((a, c) => a + (c.id === openConvId && !$('#tab-chat').hidden ? 0 : c.unread), 0);
    if (known) {
      const fresh = list.filter((o) => !known.orders.has(o.code));
      const urgent = fresh.find((o) => o.express);
      if (urgent) { beep(true); toast(`PILNE! Natychmiastowa dostawa dla ${urgent.nick}`, 'err'); }
      else if (fresh.length) { beep(false); toast(`Nowe zamówienie od ${fresh[0].nick}`); }
      else if (unread > known.unread) { beep(false); toast('Nowa wiadomość w czacie'); }
    }
    known = { orders: new Set(list.map((o) => o.code)), unread };
    orders = list;
    conversations = inbox.conversations;
    renderStats(inbox.stats);
    // Nie przerysowujemy listy, gdy admin akurat cos w niej wpisuje
    if (!$('#orderList').contains(document.activeElement)) renderOrders();
    renderConvList();

    const open = inbox.stats.byStatus.new;
    $('#ordersBadge').textContent = open;
    $('#ordersBadge').hidden = !open;
    $('#chatBadge').textContent = unread;
    $('#chatBadge').hidden = !unread;
    const urgentOpen = orders.filter((o) => o.express && (o.status === 'new' || o.status === 'in_progress')).length;
    $('#urgentBar').hidden = !urgentOpen;
    $('#urgentBar').textContent = `Natychmiastowa dostawa: ${urgentOpen} ${urgentOpen === 1 ? 'zamówienie czeka' : 'zamówienia czekają'} – kliknij i działaj!`;
    const n = open + unread;
    document.title = `${n ? `(${n}) ` : ''}Panel admina – ${data.shopName || 'Minecraft Trade Shop'}`;
  }

  $('#urgentBar').addEventListener('click', () => {
    $('.tab[data-tab=orders]').click();
    orderFilter = 'active';
    $$('#orderFilter .chip').forEach((c) => c.classList.toggle('active', c.dataset.f === 'active'));
    renderOrders();
  });

  function renderStats(st) {
    const tile = (label, value, cls = '') => `<div class="stat ${cls}"><span>${label}</span><b>${value}</b></div>`;
    $('#orderStats').innerHTML = tile('Nowe', st.byStatus.new, st.byStatus.new ? 'hl' : '')
      + tile('W realizacji', st.byStatus.in_progress)
      + tile('Pilne (natychmiast)', st.expressOpen, st.expressOpen ? 'urgent' : '')
      + tile('Dzisiaj zamówień', st.today)
      + tile('Zrealizowane', st.byStatus.done)
      + `<div class="stat stat-top"><span>Najczęściej zamawiane</span><ol>${st.top.map((t) => `<li>${esc(t.name)} <b>${t.qty}×</b></li>`).join('') || '<li class="muted">jeszcze nic</li>'}</ol></div>`;
  }

  $('#orderFilter').addEventListener('click', (e) => {
    const c = e.target.closest('[data-f]');
    if (!c) return;
    orderFilter = c.dataset.f;
    $$('#orderFilter .chip').forEach((x) => x.classList.toggle('active', x === c));
    renderOrders();
  });
  $('#orderSearch').addEventListener('input', renderOrders);

  function orderActions(o) {
    const b = (status, label, cls = 'btn-ghost') => `<button class="btn ${cls} btn-sm" data-status="${status}">${label}</button>`;
    if (o.status === 'new') return b('in_progress', 'Przyjmij', 'btn-primary') + b('done', 'Od razu gotowe') + b('cancelled', 'Anuluj', 'btn-danger');
    if (o.status === 'in_progress') return b('done', 'Dane – gotowe', 'btn-primary') + b('cancelled', 'Anuluj', 'btn-danger');
    return b('new', 'Przywróć') + '<button class="btn btn-danger btn-sm" data-delete-order>Usuń</button>';
  }

  function renderOrders() {
    const q = $('#orderSearch').value.trim().toLowerCase();
    const list = orders.filter((o) =>
      (orderFilter === 'all' || (orderFilter === 'active' ? ['new', 'in_progress'].includes(o.status) : o.status === orderFilter))
      && (!q || o.nick.toLowerCase().includes(q) || o.code.toLowerCase().includes(q) || o.lines.some((l) => l.name.toLowerCase().includes(q))));
    $('#orderList').innerHTML = list.length ? list.map((o) => `
      <article class="order-card status-${o.status} ${o.express ? 'is-express' : ''}" data-id="${o.id}">
        <header>
          <b class="order-code">#${esc(o.code)}</b>
          ${o.express ? '<span class="badge badge-express">NATYCHMIAST</span>' : ''}
          <span class="status-pill status-${o.status}">${STATUS[o.status]}</span>
          <span class="muted small" title="${new Date(o.createdAt).toLocaleString('pl-PL')}">${ago(o.createdAt)}</span>
        </header>
        <div class="order-nick">
          ${avatar(o.nick)}
          <b>${esc(o.nick)}</b>
          <button class="btn btn-ghost btn-sm" data-copy-nick="${esc(o.nick)}">Kopiuj nick</button>
          ${o.conversationId ? `<button class="btn btn-ghost btn-sm" data-open-chat="${o.conversationId}">Czat</button>` : ''}
        </div>
        <ul class="order-lines">
          ${o.lines.map((l) => `<li><div class="icon-slot">${iconHtml(l.type === 'item' ? (data.items.find((i) => i.name === l.name)?.icon || '') : (data.bundles.find((b) => b.name === l.name)?.icon || ''), l.name)}</div>
            <span><b>${l.qty}×</b> ${esc(l.name)}${l.type === 'bundle' ? ' <span class="badge">zestaw</span>' : ''}</span>
            <span class="muted small">${esc(priceText(l.prices.map((p) => ({ ...p, amount: p.amount * l.qty }))))}</span></li>`).join('')}
        </ul>
        <div class="order-total">Gracz płaci: <b>${esc(priceText(o.total))}</b>${o.expressFee.length ? ` <span class="muted small">(w tym dopłata ${esc(priceText(o.expressFee))})</span>` : ''}</div>
        ${o.customerNote ? `<p class="cust-note">Uwagi gracza: „${esc(o.customerNote)}”</p>` : ''}
        <div class="order-actions">${orderActions(o)}</div>
        <form class="admin-note">
          <input name="note" value="${esc(o.adminNote)}" maxlength="500" placeholder="Twoja notatka, np. dane do skrzynki na spawnie" aria-label="Notatka do zamówienia">
          <button class="btn btn-ghost btn-sm" type="submit">Zapisz</button>
        </form>
      </article>`).join('') : `<p class="empty">${orderFilter === 'active' ? 'Brak zamówień do zrobienia. Luz!' : 'Brak zamówień.'}</p>`;
  }

  $('#orderList').addEventListener('click', async (e) => {
    const card = e.target.closest('.order-card');
    if (!card) return;
    const id = Number(card.dataset.id);
    const st = e.target.closest('[data-status]');
    const nickBtn = e.target.closest('[data-copy-nick]');
    const chatBtn = e.target.closest('[data-open-chat]');
    try {
      if (st) {
        await call(`/api/admin/orders/${id}`, { method: 'PUT', body: { status: st.dataset.status } });
        toast(`Status: ${STATUS[st.dataset.status]}`);
        refreshLive();
      }
      if (e.target.closest('[data-delete-order]') && confirm('Usunąć to zamówienie na zawsze?')) {
        await call(`/api/admin/orders/${id}`, { method: 'DELETE' });
        toast('Usunięto zamówienie');
        refreshLive();
      }
    } catch (err) { toast(err.message, 'err'); }
    if (nickBtn) { await MTS.copy(nickBtn.dataset.copyNick); toast(`Skopiowano nick: ${nickBtn.dataset.copyNick}`); }
    if (chatBtn) { $('.tab[data-tab=chat]').click(); loadConversation(Number(chatBtn.dataset.openChat)); }
  });

  $('#orderList').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = Number(e.target.closest('.order-card').dataset.id);
    try {
      await call(`/api/admin/orders/${id}`, { method: 'PUT', body: { adminNote: e.target.note.value } });
      e.target.note.blur();
      toast('Zapisano notatkę');
      refreshLive();
    } catch (err) { toast(err.message, 'err'); }
  });

  // ---------- czat ----------
  const whoShort = { user: '', admin: 'Ty: ', ai: 'Asystent: ', system: '' };
  function renderConvList() {
    const q = $('#convSearch').value.trim().toLowerCase();
    const list = conversations.filter((c) => !q || c.nick.toLowerCase().includes(q) || c.note.toLowerCase().includes(q));
    $('#convList').innerHTML = list.length ? list.map((c) => `
      <button class="conv-item ${c.id === openConvId ? 'active' : ''} ${c.unread && c.id !== openConvId ? 'unread' : ''}" data-conv="${c.id}">
        ${avatar(c.nick)}
        <span class="conv-item-main">
          <span class="conv-item-top"><b>${esc(c.nick)}</b><span class="muted small">${ago(c.lastMessageAt)}</span></span>
          <span class="conv-preview">${esc(whoShort[c.lastSender] || '')}${esc((c.lastBody || '').slice(0, 70))}</span>
          ${c.note ? `<span class="conv-note">${esc(c.note.slice(0, 60))}</span>` : ''}
        </span>
        ${c.unread && c.id !== openConvId ? `<span class="tab-badge">${c.unread}</span>` : ''}
      </button>`).join('') : '<p class="empty">Nikt jeszcze nie napisał.</p>';
  }
  $('#convSearch').addEventListener('input', renderConvList);
  $('#convList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-conv]');
    if (b) loadConversation(Number(b.dataset.conv));
  });

  const QUICK = ['Już daję!', 'Jestem za 5 minut', 'Gdzie jesteś na mapie?', 'Wpadnij na spawn', 'Dzięki za zakupy!'];

  function convSkeleton(c) {
    $('#convView').innerHTML = `
      <header class="conv-head">
        ${avatar(c.nick, 40)}
        <div class="grow"><b>${esc(c.nick)}</b><div class="muted small">rozmowa od ${new Date(c.createdAt).toLocaleString('pl-PL')}</div></div>
        <label class="ai-toggle" title="Gdy włączony, asystent odpowiada sam. Twoja odpowiedź go wyłącza."><span class="switch"><input type="checkbox" id="convAi"><span></span></span> Asystent AI</label>
        <button class="icon-btn danger" id="convDelete" title="Usuń rozmowę" aria-label="Usuń rozmowę">${ICONS.trash}</button>
      </header>
      <div class="conv-body">
        <div class="conv-main">
          <div class="chat-messages admin-view" id="convMessages"></div>
          <div class="chat-quick">${QUICK.map((q) => `<button type="button" data-quick="${esc(q)}">${esc(q)}</button>`).join('')}</div>
          <form class="chat-form" id="convReply">
            <input name="body" maxlength="2000" placeholder="Odpisz graczowi…" autocomplete="off" required aria-label="Odpowiedź">
            <button class="btn btn-primary" type="submit">Wyślij</button>
          </form>
        </div>
        <aside class="conv-side">
          <label>Notatka – co chce kupić<textarea id="convNote" rows="4" maxlength="1000" placeholder="np. chce 2 stacki Oak Log na jutro"></textarea></label>
          <button class="btn btn-ghost btn-sm" id="convNoteSave">Zapisz notatkę</button>
          <h4>Zamówienia gracza</h4>
          <div id="convOrders"></div>
        </aside>
      </div>`;
    $('#convNote').value = c.note;
  }

  async function loadConversation(id, { quiet = false } = {}) {
    let c;
    try { c = await call(`/api/admin/conversations/${id}`); } catch (err) {
      if (!quiet) toast(err.message, 'err');
      if (err.status === 404) { openConvId = null; $('#convView').innerHTML = '<p class="empty">Rozmowa usunięta.</p>'; }
      return;
    }
    if (openConvId !== id || !$('#convMessages')) {
      openConvId = id;
      convLastId = 0;
      convSkeleton(c);
    }
    $('#convAi').checked = c.aiEnabled;
    const box = $('#convMessages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    const names = { user: c.nick, admin: 'Ty', ai: 'Asystent' };
    for (const m of c.messages) {
      if (m.id <= convLastId) continue;
      convLastId = m.id;
      const el = document.createElement('div');
      el.className = `msg msg-${m.sender}`;
      const time = new Date(m.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      el.innerHTML = m.sender === 'system' ? `<span>${esc(m.body)}</span>`
        : `<span class="msg-who">${esc(names[m.sender])} · ${time}</span><div class="msg-body">${esc(m.body)}</div>`;
      box.append(el);
    }
    if (atBottom || !quiet) box.scrollTop = box.scrollHeight;
    $('#convOrders').innerHTML = c.orders.length ? c.orders.map((o) => `
      <div class="mini-order status-${o.status}">
        <span><b>#${esc(o.code)}</b>${o.express ? ' <span class="badge badge-express">!</span>' : ''} <span class="status-pill status-${o.status}">${STATUS[o.status]}</span></span>
        <span class="small muted">${o.lines.map((l) => `${l.qty}× ${esc(l.name)}`).join(', ')}</span>
      </div>`).join('') : '<p class="muted small">Brak zamówień.</p>';
    const item = conversations.find((x) => x.id === id);
    if (item) item.unread = 0;
    renderConvList();
  }

  async function sendAdmin(body) {
    if (!body.trim() || !openConvId) return;
    const f = $('#convReply');
    f.body.value = '';
    try {
      await call(`/api/admin/conversations/${openConvId}/messages`, { method: 'POST', body: { body } });
      await loadConversation(openConvId);
    } catch (err) { f.body.value = body; toast(err.message, 'err'); }
  }

  $('#convView').addEventListener('submit', (e) => {
    if (e.target.id !== 'convReply') return;
    e.preventDefault();
    sendAdmin(e.target.body.value);
  });
  $('#convView').addEventListener('click', async (e) => {
    const q = e.target.closest('[data-quick]');
    if (q) return sendAdmin(q.dataset.quick);
    try {
      if (e.target.closest('#convNoteSave')) {
        await call(`/api/admin/conversations/${openConvId}`, { method: 'PUT', body: { note: $('#convNote').value } });
        toast('Zapisano notatkę');
        refreshLive();
      }
      if (e.target.closest('#convDelete')) {
        const c = conversations.find((x) => x.id === openConvId);
        if (!confirm(`Usunąć całą rozmowę z ${c?.nick || 'graczem'}?`)) return;
        await call(`/api/admin/conversations/${openConvId}`, { method: 'DELETE' });
        openConvId = null;
        $('#convView').innerHTML = '<p class="empty">Wybierz rozmowę z listy.</p>';
        toast('Usunięto rozmowę');
        refreshLive();
      }
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#convView').addEventListener('change', async (e) => {
    if (e.target.id !== 'convAi') return;
    try {
      await call(`/api/admin/conversations/${openConvId}`, { method: 'PUT', body: { aiEnabled: e.target.checked } });
      toast(e.target.checked ? 'Asystent znowu odpowiada w tej rozmowie' : 'Asystent wyłączony – odpisujesz sam');
    } catch (err) { toast(err.message, 'err'); e.target.checked = !e.target.checked; }
  });

  boot();
})();
