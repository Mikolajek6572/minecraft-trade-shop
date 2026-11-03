// Publiczny cennik
(() => {
  const { esc, iconHtml, api, valueCalculator, priceText, toast, copy, roman } = MTS;
  const $ = (s) => document.querySelector(s);

  const state = { data: null, category: 'all', q: '', sort: 'default' };

  function priceChips(prices) {
    const icons = new Map(state.data.items.map((i) => [i.name.toLowerCase(), i.icon]));
    return prices.map((p) => `<span class="price-chip">${iconHtml(icons.get(p.currency.toLowerCase()) || '', p.currency, 'sm')}<b>${p.amount}×</b> ${esc(p.currency)}</span>`)
      .join('<span class="plus">+</span>');
  }

  const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString('pl-PL');

  function renderBundles() {
    const { bundles, items } = state.data;
    $('#bundlesSection').hidden = bundles.length === 0;
    const calc = valueCalculator(items);
    const byId = new Map(items.map((i) => [i.id, i]));

    $('#bundles').innerHTML = bundles.map((b) => {
      // Cena normalna = suma cen przedmiotow z zestawu, liczona po walutach
      const regular = new Map();
      let complete = true;
      for (const bi of b.items) {
        const it = byId.get(bi.item_id);
        if (!it || !it.prices.length) { complete = false; continue; }
        for (const p of it.prices) {
          const k = p.currency.toLowerCase();
          const cur = regular.get(k) || { currency: p.currency, amount: 0 };
          cur.amount += p.amount * bi.qty;
          regular.set(k, cur);
        }
      }
      const regularList = [...regular.values()];
      const savings = [];
      if (complete) {
        for (const r of regularList) {
          const paid = b.prices.find((p) => p.currency.toLowerCase() === r.currency.toLowerCase());
          if (paid && paid.amount < r.amount) savings.push({ currency: r.currency, amount: r.amount - paid.amount });
        }
        // Rozne waluty: porownanie po wartosci w podstawowych przedmiotach
        if (!savings.length) {
          const a = calc.ofPrices(regularList), c = calc.ofPrices(b.prices);
          if (a.base.size === 1 && c.base.size === 1 && [...a.base][0] === [...c.base][0] && c.value < a.value)
            savings.push({ currency: [...a.base][0], amount: Math.round(a.value - c.value), approx: true });
        }
      }
      const text = `${b.name} = ${priceText(b.prices)}`;
      return `
        <article class="bundle-card">
          ${savings.length ? `<div class="ribbon">-${savings.map((s) => `${s.approx ? '≈' : ''}${s.amount} ${esc(s.currency)}`).join(', ')}</div>` : ''}
          <div class="bundle-head">
            <div class="icon-slot lg">${iconHtml(b.icon, b.items[0]?.name || b.name)}</div>
            <div>
              <h3>${esc(b.name)}</h3>
              ${b.description ? `<p class="muted">${esc(b.description)}</p>` : ''}
            </div>
          </div>
          <ul class="bundle-items">
            ${b.items.map((bi) => {
              const it = byId.get(bi.item_id);
              return `<li>
                <div class="icon-slot">${iconHtml(it?.icon, bi.name)}</div>
                <span>${bi.qty > 1 ? `${bi.qty}× ` : ''}${esc(bi.name)}</span>
                <span class="muted small">${it?.prices.length ? esc(priceText(it.prices.map((p) => ({ ...p, amount: p.amount * bi.qty })))) : ''}</span>
              </li>`;
            }).join('')}
          </ul>
          <div class="bundle-price">
            ${complete && savings.length ? `<div class="old-price">Osobno: <s>${esc(priceText(regularList))}</s></div>` : ''}
            <div class="new-price"><span class="muted">Cena zestawu</span> ${priceChips(b.prices)}</div>
            ${savings.length ? `<div class="save">Oszczędzasz ${savings.map((s) => `<b>${s.approx ? '≈ ' : ''}${s.amount} ${esc(s.currency)}</b>`).join(', ')} kupując cały komplet!</div>` : ''}
          </div>
          <div class="bundle-actions">
            <button class="btn btn-primary add-btn" data-add="bundle:${b.id}">${cartIcon} Zamów zestaw</button>
            <button class="btn btn-ghost copy-btn" data-copy="${esc(text)}">${copyIcon} Kopiuj cenę</button>
          </div>
        </article>`;
    }).join('');
  }

  const cartIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a1.5 1.5 0 0 0 1.5 1.1h8.6a1.5 1.5 0 0 0 1.5-1.1L21 7H6"/></svg>';
  const sparkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>';
  const enchFor = (itemId) => state.data.enchants?.some((e) => e.itemIds.includes(itemId));
  const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

  function renderCategories() {
    const { categories, items } = state.data;
    const used = categories.filter((c) => items.some((i) => i.category_id === c.id));
    const chip = (id, label, count, icon) => `<button class="chip ${state.category === String(id) ? 'active' : ''}" data-cat="${id}" role="tab" aria-selected="${state.category === String(id)}">
      ${icon ? iconHtml(icon, label, 'xs') : ''}${esc(label)} <span class="count">${count}</span></button>`;
    $('#categories').innerHTML = chip('all', 'Wszystko', items.length)
      + used.map((c) => chip(c.id, c.name, items.filter((i) => i.category_id === c.id).length, c.icon)).join('');
  }

  function renderItems() {
    const { items, categories } = state.data;
    const calc = valueCalculator(items);
    const catName = new Map(categories.map((c) => [c.id, c.name]));
    const q = state.q.trim().toLowerCase();

    let list = items.filter((i) =>
      (state.category === 'all' || String(i.category_id) === state.category)
      && (!q || i.name.toLowerCase().includes(q) || i.prices.some((p) => p.currency.toLowerCase().includes(q))));

    const val = (i) => calc.ofPrices(i.prices).value;
    const sorters = {
      'value-asc': (a, b) => val(a) - val(b),
      'value-desc': (a, b) => val(b) - val(a),
      'name-asc': (a, b) => a.name.localeCompare(b.name, 'pl'),
      'name-desc': (a, b) => b.name.localeCompare(a.name, 'pl'),
    };
    if (sorters[state.sort]) list = [...list].sort(sorters[state.sort]);

    $('#empty').hidden = list.length > 0;
    $('#grid').innerHTML = list.map((i) => {
      const v = calc.ofPrices(i.prices);
      const base = [...v.base];
      const showValue = base.length === 1 && !i.prices.every((p) => p.currency === base[0]);
      const text = `${i.name} = ${priceText(i.prices)}`;
      return `
        <article class="item-card">
          <div class="item-top">
            <div class="icon-slot">${iconHtml(i.icon, i.name)}</div>
            <div class="item-title">
              <h3>${esc(i.name)}</h3>
              ${i.category_id && catName.has(i.category_id) ? `<span class="badge">${esc(catName.get(i.category_id))}</span>` : ''}
            </div>
          </div>
          ${i.note ? `<p class="note">${esc(i.note)}</p>` : ''}
          <div class="price">${priceChips(i.prices)}</div>
          <div class="item-foot">
            <span class="muted small" title="Wartość przeliczona na najprostszy przedmiot">${showValue ? `≈ ${fmt(v.value)} ${esc(base[0])}` : ''}</span>
            <div class="item-actions">
              <button class="icon-btn copy-btn" data-copy="${esc(text)}" aria-label="Kopiuj cenę ${esc(i.name)}" title="Kopiuj cenę">${copyIcon}</button>
              ${enchFor(i.id) ? `<button class="btn btn-ghost btn-sm ench-btn" data-ench-item="${i.id}" title="Zamów z enchantami">${sparkIcon} Enchanty</button>` : ''}
              <button class="btn btn-primary btn-sm add-btn" data-add="item:${i.id}" aria-label="Zamów ${esc(i.name)}">${cartIcon} Zamów</button>
            </div>
          </div>
        </article>`;
    }).join('');
    // Kolejne kafelki pojawiaja sie po kolei (przez CSSOM, bo CSP blokuje inline style)
    $('#grid').querySelectorAll('.item-card').forEach((el, idx) => el.style.setProperty('--i', Math.min(idx, 20)));
  }

  function renderEnchants() {
    const { enchants = [], items } = state.data;
    $('#enchantsSection').hidden = enchants.length === 0;
    const byId = new Map(items.map((i) => [i.id, i]));
    $('#enchants').innerHTML = enchants.map((e) => {
      const on = e.itemIds.map((id) => byId.get(id)).filter(Boolean);
      return `<article class="ench-card">
        <div class="ench-top">
          <div class="icon-slot">${iconHtml('mc:Enchanted_Book', 'Enchanted Book')}</div>
          <div class="item-title">
            <h3>${esc(e.name)}</h3>
            <span class="badge badge-ench">maks. ${roman(e.maxLevel)}</span>
          </div>
        </div>
        ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
        <div class="price">${priceChips(e.prices)}<span class="muted small">/ poziom</span></div>
        ${on.length ? `<div class="ench-on"><span class="muted small">Pasuje do:</span> ${on.map((i) => `<span title="${esc(i.name)}">${iconHtml(i.icon, i.name, 'sm')}</span>`).join('')}</div>` : ''}
        ${e.book ? `<button class="btn btn-ghost btn-sm" data-book="${e.id}">${sparkIcon} Kup księgę</button>` : ''}
      </article>`;
    }).join('');
  }

  function render() {
    document.title = state.data.shopName;
    $('#shopName').textContent = state.data.shopName;
    renderBundles();
    renderEnchants();
    renderCategories();
    renderItems();
  }

  let lastJson = '';
  async function load() {
    try {
      const data = await api('/api/catalog');
      // Koszyk i czat dostaja swieze dane, a cennik przerysowuje sie tylko gdy cos sie zmienilo
      window.dispatchEvent(new CustomEvent('mts:data', { detail: data }));
      const json = JSON.stringify({ ...data, shop: null });
      if (json === lastJson) return;
      lastJson = json;
      state.data = data;
      if (state.category !== 'all' && !state.data.categories.some((c) => String(c.id) === state.category)) state.category = 'all';
      render();
    } catch (e) {
      if (!state.data) $('#grid').innerHTML = `<p class="empty">Nie udało się wczytać cennika. Odśwież stronę.</p>`;
    }
  }

  $('#search').addEventListener('input', (e) => { state.q = e.target.value; renderItems(); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderItems(); });
  $('#categories').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    state.category = b.dataset.cat;
    renderCategories();
    renderItems();
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('.copy-btn');
    if (!b) return;
    await copy(b.dataset.copy);
    b.classList.add('copied');
    setTimeout(() => b.classList.remove('copied'), 1200);
    toast(`Skopiowano: ${b.dataset.copy}`);
  });

  load();
  // Zmiany z panelu admina pojawiaja sie same
  setInterval(() => { if (!document.hidden) load(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
