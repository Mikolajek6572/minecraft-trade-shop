// Kody promocyjne: -X% od ceny przedmiotow
import { HttpError } from './catalog.js';
import { rateLimit, text } from './shop.js';

const CODE_RE = /^[A-Z0-9_-]{3,30}$/;

const view = (p) => ({
  id: p.id, code: p.code, percent: p.percent, expiresAt: p.expires_at, maxUses: p.max_uses, uses: p.uses,
  active: !!p.active, public: !!p.public, note: p.note, createdAt: p.created_at,
});

function problem(p) {
  if (!p || !p.active) return 'Nie ma takiego kodu';
  if (p.expires_at && p.expires_at < Date.now()) return 'Ten kod już wygasł';
  if (p.max_uses && p.uses >= p.max_uses) return 'Ten kod został już wykorzystany';
  return null;
}

// Rabat: kazda kwota w cenie -X%, zaokraglona (min. 1, jesli cos kosztowalo)
export const discount = (prices, percent) =>
  prices.map((p) => ({ currency: p.currency, amount: Math.max(1, Math.round(p.amount * (100 - percent) / 100)) }));

export async function findValid(db, code) {
  const c = String(code || '').trim().toUpperCase();
  if (!CODE_RE.test(c)) throw new HttpError(400, 'Nie ma takiego kodu');
  const p = await db.prepare('SELECT * FROM promo_codes WHERE code = ?').bind(c).first();
  const err = problem(p);
  if (err) throw new HttpError(400, err);
  return p;
}

// Zuzycie kodu przy zamowieniu (atomowo, zeby limit nie przeskoczyl)
export async function use(db, id) {
  const r = await db.prepare('UPDATE promo_codes SET uses = uses + 1 WHERE id = ? AND active = 1 AND (max_uses IS NULL OR uses < max_uses)').bind(id).run();
  if (!r.meta.changes) throw new HttpError(400, 'Ten kod został już wykorzystany');
}

export async function check(db, body, clientIp) {
  await rateLimit(db, `promo:${clientIp}`, 20, 10 * 60_000, 'Za dużo prób kodów. Spróbuj za chwilę');
  const p = await findValid(db, body.code);
  return { code: p.code, percent: p.percent, expiresAt: p.expires_at };
}

export async function publicPromos(db) {
  const { results } = await db.prepare(`SELECT * FROM promo_codes WHERE active = 1 AND public = 1
    AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses) ORDER BY percent DESC`).bind(Date.now()).all();
  return results.map((p) => ({ code: p.code, percent: p.percent, expiresAt: p.expires_at }));
}

// ---------- admin ----------
export async function list(db) {
  const { results } = await db.prepare('SELECT * FROM promo_codes ORDER BY active DESC, created_at DESC').all();
  return results.map(view);
}

export async function save(db, id, body) {
  const code = String(body.code || '').trim().toUpperCase();
  if (!CODE_RE.test(code)) throw new HttpError(400, 'Kod: 3–30 znaków, litery, cyfry, _ i -');
  const percent = Number(body.percent);
  if (!Number.isInteger(percent) || percent < 1 || percent > 90) throw new HttpError(400, 'Rabat musi być od 1 do 90%');
  const expiresAt = body.expiresAt === null || body.expiresAt === '' || body.expiresAt === undefined ? null : Number(body.expiresAt);
  if (expiresAt !== null && !Number.isFinite(expiresAt)) throw new HttpError(400, 'Zła data ważności');
  const maxUses = body.maxUses === null || body.maxUses === '' || body.maxUses === undefined ? null : Number(body.maxUses);
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1_000_000)) throw new HttpError(400, 'Limit użyć musi być liczbą od 1');
  const note = text(body.note, 'Opis', 200);
  const active = body.active === false ? 0 : 1;
  const pub = body.public ? 1 : 0;
  try {
    if (id) {
      const r = await db.prepare('UPDATE promo_codes SET code = ?, percent = ?, expires_at = ?, max_uses = ?, active = ?, public = ?, note = ? WHERE id = ?')
        .bind(code, percent, expiresAt, maxUses, active, pub, note, id).run();
      if (!r.meta.changes) throw new HttpError(404, 'Nie ma takiego kodu');
      return id;
    }
    return (await db.prepare(`INSERT INTO promo_codes (code, percent, expires_at, max_uses, active, public, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(code, percent, expiresAt, maxUses, active, pub, note, Date.now()).first()).id;
  } catch (e) {
    if (String(e?.message).includes('UNIQUE')) throw new HttpError(400, 'Taki kod już istnieje');
    throw e;
  }
}

export async function remove(db, id) {
  return (await db.prepare('DELETE FROM promo_codes WHERE id = ?').bind(id).run()).meta.changes > 0;
}
