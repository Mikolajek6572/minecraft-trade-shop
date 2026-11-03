// Wspolne rzeczy: ustawienia sklepu, limity zapytan, walidacja nicku
import { HttpError } from './catalog.js';

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    shopName: s.shop_name || 'Minecraft Trade Shop',
    expressEnabled: s.express_enabled !== '0',
    expressFee: { amount: Number(s.express_fee_amount) || 0, currency: s.express_fee_currency || '' },
    aiEnabled: s.ai_enabled !== '0',
    adminOnline: Date.now() - (Number(s.admin_seen) || 0) < 60_000,
  };
}

export const expressFeeList = (settings) =>
  settings.expressFee.amount > 0 && settings.expressFee.currency ? [{ ...settings.expressFee }] : [];

// Limit: max `max` zapytan na `windowMs` dla danego klucza (np. IP albo rozmowa)
export async function rateLimit(db, key, max, windowMs, msg = 'Za dużo prób. Spróbuj za chwilę') {
  const now = Date.now();
  const row = await db.prepare(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN reset_at < ?3 THEN 1 ELSE count + 1 END,
      reset_at = CASE WHEN reset_at < ?3 THEN ?2 ELSE reset_at END
    RETURNING count`).bind(key, now + windowMs, now).first();
  if (Math.random() < 0.05) await db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(now).run();
  if (row.count > max) throw new HttpError(429, msg);
}

// Nick z Minecrafta (Java: 3-16 znakow, litery/cyfry/_; Bedrock moze miec spacje i kropke z przodu)
export function validNick(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\.?[A-Za-z0-9_ ]{3,16}$/.test(s)) throw new HttpError(400, 'Wpisz nick z Minecrafta: 3–16 znaków (litery, cyfry, _)');
  return s;
}

export function text(v, field, max) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length > max) throw new HttpError(400, `${field} może mieć max. ${max} znaków`);
  return s;
}

export const ip = (request) => request.headers.get('CF-Connecting-IP') || 'local';

export const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

export const sha256 = async (s) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function sumPrices(lists) {
  const m = new Map();
  for (const { prices, qty = 1 } of lists) {
    for (const p of prices) {
      const k = p.currency.toLowerCase();
      const cur = m.get(k) || { currency: p.currency, amount: 0 };
      cur.amount += p.amount * qty;
      m.set(k, cur);
    }
  }
  return [...m.values()];
}
