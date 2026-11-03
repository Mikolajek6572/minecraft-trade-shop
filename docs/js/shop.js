// Koszyk, zamawianie z nickiem, moje zamowienia i czat ze sklepem
(() => {
  const { esc, iconHtml, api, priceText, toast } = MTS;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* tryb prywatny */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* tryb prywatny */ } },
  };

  const STATUS = { new: 'Nowe', in_progress: 'W realizacji', done: 'Zrealizowane', cancelled: 'Anulowane' };
  const NICK_RE = /^\.?[A-Za-z0-9_ ]{3,16}$/;

  let data = null;
  let cart = store.get('mts_cart', []);
  let myOrders = store.get('mts_orders', []);

  // ---------- panele ----------
  let openPanel = null;
  function showPanel(id) {
    if (openPanel && openPanel !== id) $(`#${openPanel}`).hidden = true;
    openPanel = id;
    $(`#${id}`).hidden = false;
    $('#backdrop').hidden = false;
    document.body.classList.add('panel-open');
    if (id === 'chatPanel') onChatOpen();
  }
  function hidePanel() {
    if (!openPanel) return;
    $(`#${openPanel}`).hidden = true;
    openPanel = null;
    $('#backdrop').hidden = true;
    document.body.classList.remove('panel-open');
  }
  $('#backdrop').addEventListener('click', hidePanel);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePanel(); });
  $$('[data-close-panel]').forEach((b) => b.addEventListener('click', hidePanel));
  $('#cartFab').addEventListener('click', () => (openPanel === 'cartPanel' ? hidePanel() : showPanel('cartPanel')));
  $('#chatFab').addEventListener('click', () => (openPanel === 'chatPanel' ? hidePanel() : showPanel('chatPanel')));

  function switchCartTab(tab) {
    $$('.dtab').forEach((t) => t.classList.toggle('active', t.dataset.dtab === tab));
    $('#dtab-cart').hidden = tab !== 'cart';
    $('#dtab-myorders').hidden = tab !== 'myorders';
    if (tab === 'myorders') refreshMyOrders();
  }
  $$('.dtab').forEach((t) => t.addEventListener('click', () => switchCartTab(t.dataset.dtab)));

  // ---------- koszyk ----------
  function find(line) {
    if (!data) return null;
    return line.type === 'bundle' ? data.bundles.find((b) => b.id === line.id) : data.items.find((i) => i.id === line.id);
  }

  function itemIcon(name) {
    return data?.items.find((i) => i.name.toLowerCase() === String(name).toLowerCase())?.icon || '';
  }

  function priceChips(prices) {
    return prices.map((p) => `<span class="price-chip">${iconHtml(itemIcon(p.currency), p.currency, 'sm')}<b>${p.amount}×</b> ${esc(p.currency)}</span>`)
      .join('<span class="plus">+</span>');
  }

  function sum(lines) {
    const m = new Map();
    for (const { prices, qty } of lines) for (const p of prices) {
      const k = p.currency.toLowerCase();
      const cur = m.get(k) || { currency: p.currency, amount: 0 };
      cur.amount += p.amount * qty;
      m.set(k, cur);
    }
    return [...m.values()];
  }

  const saveCart = () => store.set('mts_cart', cart);

  function renderCart() {
    if (data) cart = cart.filter((l) => find(l));
    const count = cart.reduce((a, l) => a + l.qty, 0);
    $('#cartCount').textContent = count > 99 ? '99+' : count;
    $('#cartCount').hidden = count === 0;
    $('#cartEmpty').hidden = cart.length > 0;
    $('#orderForm').hidden = cart.length === 0;
    if (!data) return;

    $('#cartLines').innerHTML = cart.map((l, idx) => {
      const src = find(l);
      const icon = l.type === 'bundle' ? iconHtml(src.icon, src.items[0]?.name || src.name) : iconHtml(src.icon, src.name);
      return `<div class="cart-line" data-idx="${idx}">
        <div class="icon-slot">${icon}</div>
        <div class="cart-line-main">
          <b>${esc(src.name)}</b>${l.type === 'bundle' ? ' <span class="badge">zestaw</span>' : ''}
          <span class="muted small">${esc(priceText(src.prices))} / szt.</span>
        </div>
        <div class="qty">
          <button type="button" class="icon-btn" data-qty="-1" aria-label="Mniej">−</button>
          <input type="number" min="1" max="999" value="${l.qty}" aria-label="Ilość">
          <button type="button" class="icon-btn" data-qty="1" aria-label="Więcej">+</button>
        </div>
        <button type="button" class="icon-btn danger" data-remove-line aria-label="Usuń z koszyka">✕</button>
      </div>`;
    }).join('');

    const shop = data.shop || {};
    const express = $('#orderForm').express.checked && shop.expressEnabled;
    const fee = shop.expressFee?.amount > 0 ? [{ currency: shop.expressFee.currency, amount: shop.expressFee.amount }] : [];
    const total = sum([...cart.map((l) => ({ prices: find(l).prices, qty: l.qty })), ...(express ? [{ prices: fee, qty: 1 }] : [])]);
    $('#cartTotal').innerHTML = priceChips(total);
    $('#expressBox').hidden = !shop.expressEnabled;
    $('#expressFee').textContent = fee.length ? `+ ${priceText(fee)}` : 'gratis';
  }

  function addToCart(type, id) {
    const line = cart.find((l) => l.type === type && l.id === id);
    if (line) line.qty = Math.min(999, line.qty + 1);
    else cart.push({ type, id, qty: 1 });
    saveCart();
    renderCart();
    const src = find({ type, id });
    toast(`Dodano do koszyka: ${src?.name || ''}`);
    $('#cartFab').classList.remove('bump');
    void $('#cartFab').offsetWidth;
    $('#cartFab').classList.add('bump');
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const [type, id] = b.dataset.add.split(':');
    addToCart(type, Number(id));
  });

  $('#cartLines').addEventListener('click', (e) => {
    const row = e.target.closest('.cart-line');
    if (!row) return;
    const line = cart[Number(row.dataset.idx)];
    if (e.target.closest('[data-remove-line]')) cart.splice(Number(row.dataset.idx), 1);
    const d = e.target.closest('[data-qty]');
    if (d) {
      line.qty = Math.max(1, Math.min(999, line.qty + Number(d.dataset.qty)));
    }
    saveCart();
    renderCart();
  });
  $('#cartLines').addEventListener('change', (e) => {
    const row = e.target.closest('.cart-line');
    if (!row) return;
    const n = Math.round(Number(e.target.value));
    cart[Number(row.dataset.idx)].qty = Number.isFinite(n) ? Math.max(1, Math.min(999, n)) : 1;
    saveCart();
    renderCart();
  });
  $('#orderForm').express.addEventListener('change', renderCart);

  // Nick zapamietany i wspolny dla koszyka i czatu
  const savedNick = store.get('mts_nick', '');
  $('#orderForm').nick.value = savedNick;
  $('#chatStart').nick.value = savedNick;

  $('#orderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('.form-error', f);
    err.textContent = '';
    const nick = f.nick.value.trim();
    if (!NICK_RE.test(nick)) { err.textContent = 'Wpisz nick z Minecrafta: 3–16 znaków (litery, cyfry, _)'; f.nick.focus(); return; }
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      const order = await api('/api/orders', {
        method: 'POST',
        body: { nick, express: f.express.checked && !!data?.shop?.expressEnabled, note: f.note.value, lines: cart.map(({ type, id, qty }) => ({ type, id, qty })) },
        headers: chatHeaders(),
      });
      store.set('mts_nick', nick);
      myOrders = [order.code, ...myOrders.filter((c) => c !== order.code)].slice(0, 20);
      store.set('mts_orders', myOrders);
      cart = [];
      saveCart();
      f.note.value = '';
      f.express.checked = false;
      renderCart();
      switchCartTab('myorders');
      toast(`Zamówienie #${order.code} wysłane! Admin już je widzi`);
      if (chatToken()) pollChat();
    } catch (er) {
      err.textContent = er.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- moje zamowienia ----------
  const ago = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'przed chwilą';
    if (s < 3600) return `${Math.floor(s / 60)} min temu`;
    if (s < 86400) return `${Math.floor(s / 3600)} h temu`;
    return new Date(ts).toLocaleDateString('pl-PL');
  };

  async function refreshMyOrders() {
    const box = $('#myOrders');
    if (!myOrders.length) { box.innerHTML = '<p class="empty">Nie masz jeszcze zamówień z tego urządzenia.</p>'; return; }
    const results = await Promise.all(myOrders.map((code) => api(`/api/orders/${code}`).catch((e) => (e.status === 404 ? { code, gone: true } : null))));
    // Usuniete przez admina znikaja z listy
    myOrders = myOrders.filter((c) => !results.find((r) => r?.code === c && r.gone));
    store.set('mts_orders', myOrders);
    box.innerHTML = results.filter((o) => o && !o.gone).map((o) => `
      <article class="my-order status-${o.status}">
        <header>
          <b>#${esc(o.code)}</b>
          ${o.express ? '<span class="badge badge-express">natychmiast</span>' : ''}
          <span class="status-pill status-${o.status}">${STATUS[o.status]}</span>
        </header>
        <p class="small">${o.lines.map((l) => `${l.qty}× ${esc(l.name)}`).join(', ')}</p>
        <div class="my-order-foot">
          <span class="small muted">dla <b>${esc(o.nick)}</b> · ${ago(o.createdAt)}</span>
          <span class="small">${esc(priceText(o.total))}</span>
        </div>
      </article>`).join('') || '<p class="empty">Brak zamówień.</p>';
  }

  // ---------- czat ----------
  const chatToken = () => store.get('mts_chat_token', null);
  const chatHeaders = () => (chatToken() ? { 'X-Chat-Token': chatToken() } : {});
  let lastId = 0;
  let lastReplyId = 0;
  let seenId = store.get('mts_chat_seen', 0);
  let waitingAi = 0; // id wiadomosci, na ktora czekamy z odpowiedzia asystenta
  let chatTimer = null;

  function chatUi() {
    const has = !!chatToken();
    $('#chatStart').hidden = has;
    $('#chatMain').hidden = !has;
  }

  const senderName = { admin: 'Admin', ai: 'Asystent', user: 'Ty' };

  function addMessages(msgs) {
    const box = $('#chatMessages');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    for (const m of msgs) {
      if (m.id <= lastId) continue;
      lastId = m.id;
      if (m.sender !== 'user') lastReplyId = m.id;
      const el = document.createElement('div');
      el.className = `msg msg-${m.sender}`;
      const time = new Date(m.createdAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      el.innerHTML = m.sender === 'system'
        ? `<span>${esc(m.body)}</span>`
        : `<span class="msg-who">${senderName[m.sender]} · ${time}</span><div class="msg-body">${esc(m.body)}</div>`;
      box.append(el);
      if (m.sender !== 'user' && waitingAi && m.id > waitingAi) waitingAi = 0;
    }
    $('#typing')?.remove();
    if (waitingAi) {
      const t = document.createElement('div');
      t.id = 'typing';
      t.className = 'msg msg-ai typing';
      t.innerHTML = '<span class="msg-who">Asystent pisze</span><div class="msg-body"><i></i><i></i><i></i></div>';
      box.append(t);
    }
    if (atBottom || msgs.length) box.scrollTop = box.scrollHeight;
  }

  function setStatus(s) {
    $('#chatStatus').innerHTML = s.adminOnline
      ? '<span class="online-dot"></span> Admin jest online'
      : `<span class="offline-dot"></span> Admin offline${s.aiActive ? ' · odpowiada asystent' : ''}`;
  }

  async function pollChat() {
    if (!chatToken()) return;
    try {
      const r = await api(`/api/chat/messages?after=${lastId}`, { headers: chatHeaders() });
      setStatus(r);
      addMessages(r.messages);
      if (openPanel === 'chatPanel') { seenId = lastId; store.set('mts_chat_seen', seenId); }
      // Kropka na przycisku gdy przyszla odpowiedz, a czat jest zamkniety
      $('#chatDot').hidden = openPanel === 'chatPanel' || lastReplyId <= seenId;
    } catch (e) {
      if (e.status === 401) { store.del('mts_chat_token'); lastId = 0; $('#chatMessages').innerHTML = ''; chatUi(); }
    }
  }

  function scheduleChat() {
    clearTimeout(chatTimer);
    const delay = openPanel === 'chatPanel' ? (waitingAi ? 1500 : 3500) : 20000;
    chatTimer = setTimeout(async () => {
      if (!document.hidden) await pollChat();
      if (waitingAi && Date.now() - waitingSince > 30000) { waitingAi = 0; $('#typing')?.remove(); }
      scheduleChat();
    }, delay);
  }
  let waitingSince = 0;

  function onChatOpen() {
    chatUi();
    $('#chatDot').hidden = true;
    seenId = lastId;
    store.set('mts_chat_seen', seenId);
    if (chatToken()) { pollChat(); setTimeout(() => $('#chatForm').body.focus(), 50); }
    else $('#chatStart').nick.focus();
    scheduleChat();
  }

  $('#chatStart').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('.form-error', f);
    err.textContent = '';
    const nick = f.nick.value.trim();
    if (!NICK_RE.test(nick)) { err.textContent = 'Wpisz nick z Minecrafta: 3–16 znaków (litery, cyfry, _)'; return; }
    try {
      const r = await api('/api/chat/start', { method: 'POST', body: { nick } });
      store.set('mts_chat_token', r.token);
      store.set('mts_nick', nick);
      if (!$('#orderForm').nick.value) $('#orderForm').nick.value = nick;
      lastId = 0;
      $('#chatMessages').innerHTML = '';
      onChatOpen();
    } catch (er) { err.textContent = er.message; }
  });

  async function send(body) {
    if (!body.trim()) return;
    const f = $('#chatForm');
    f.body.value = '';
    try {
      const r = await api('/api/chat/messages', { method: 'POST', body: { body }, headers: chatHeaders() });
      if (r.aiThinking) { waitingAi = r.message.id; waitingSince = Date.now(); }
      addMessages([r.message]);
      setStatus(r);
      scheduleChat();
    } catch (er) {
      f.body.value = body;
      toast(er.message, 'err');
      if (er.status === 401) { store.del('mts_chat_token'); chatUi(); }
    }
  }
  $('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); send(e.target.body.value); });
  $('#chatQuick').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) send(b.dataset.q); });

  // ---------- dane z cennika ----------
  window.addEventListener('mts:data', (e) => {
    data = e.detail;
    renderCart();
  });

  renderCart();
  chatUi();
  if (chatToken()) { pollChat(); scheduleChat(); }
})();
