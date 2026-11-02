// Wspolne funkcje strony publicznej i panelu admina
const MTS = (() => {
  const API = window.MTS_CONFIG.api.replace(/\/+$/, '');
  const TOKEN_KEY = 'mts_admin_token';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const wikiName = (name) => String(name).trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_'()\-]/g, '');

  // Ikona: https://... | mc:Nazwa | '' (auto z nazwy przedmiotu)
  function iconUrl(icon, name) {
    if (icon && /^https:\/\//.test(icon)) return icon;
    const n = icon && icon.startsWith('mc:') ? icon.slice(3) : wikiName(name || '');
    return n ? `${API}/icons/${encodeURIComponent(n)}.png` : '';
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  }

  // <img> z placeholderem gdy ikona sie nie zaladuje
  function iconHtml(icon, name, cls = '') {
    const url = iconUrl(icon, name);
    const ph = `<span class="mc-icon-ph ${cls}" data-ph="${esc(initials(name))}" aria-hidden="true"></span>`;
    if (!url) return ph;
    return `<img class="mc-icon ${cls}" src="${esc(url)}" alt="" loading="lazy" data-ph="${esc(initials(name))}">`;
  }

  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('mc-icon')) return;
    const span = document.createElement('span');
    span.className = img.className.replace('mc-icon', 'mc-icon-ph');
    span.dataset.ph = img.dataset.ph || '?';
    span.setAttribute('aria-hidden', 'true');
    img.replaceWith(span);
  }, true);

  // Token sesji admina (przegladarka trzyma go tylko na tym urzadzeniu)
  const token = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch { /* tryb prywatny */ } },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* tryb prywatny */ } },
  };

  async function api(path, { method = 'GET', body } = {}) {
    const t = token.get();
    let r;
    try {
      r = await fetch(API + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(t ? { Authorization: `Bearer ${t}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Brak połączenia z serwerem');
    }
    let data = null;
    try { data = await r.json(); } catch { /* pusta odpowiedz */ }
    if (!r.ok) throw Object.assign(new Error(data?.error || `Błąd ${r.status}`), { status: r.status });
    return data;
  }

  // Obrazki oznaczone data-icon="mc:Nazwa" (logo, favicon) dostaja adres z API
  document.querySelectorAll('[data-icon]').forEach((el) => {
    const url = iconUrl(el.dataset.icon, '');
    if (el.tagName === 'LINK') el.href = url; else el.src = url;
  });

  // Wartosc przedmiotu w najprostszych przedmiotach (np. Dirt), do sortowania i porownan
  function valueCalculator(items) {
    const byName = new Map(items.map((i) => [i.name.toLowerCase(), i]));
    const memo = new Map();
    function value(name, stack = new Set()) {
      const key = String(name).toLowerCase();
      if (memo.has(key)) return memo.get(key);
      const item = byName.get(key);
      if (!item || !item.prices.length || stack.has(key)) return { value: 1, base: new Set([item ? item.name : name]) };
      stack.add(key);
      let total = 0;
      const base = new Set();
      for (const p of item.prices) {
        const v = value(p.currency, stack);
        total += p.amount * v.value;
        v.base.forEach((b) => base.add(b));
      }
      stack.delete(key);
      const r = { value: total, base };
      memo.set(key, r);
      return r;
    }
    const ofPrices = (prices) => {
      let total = 0;
      const base = new Set();
      for (const p of prices) {
        const v = value(p.currency);
        total += p.amount * v.value;
        v.base.forEach((b) => base.add(b));
      }
      return { value: total, base };
    };
    return { value, ofPrices };
  }

  const priceText = (prices) => prices.map((p) => `${p.amount} ${p.currency}`).join(' + ');

  function toast(msg, type = 'ok') {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      box.setAttribute('role', 'status');
      document.body.append(box);
    }
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    box.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  return { esc, wikiName, iconUrl, iconHtml, api, token, valueCalculator, priceText, toast, copy };
})();
