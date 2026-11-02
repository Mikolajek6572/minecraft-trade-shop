// Logowanie admina: hasla PBKDF2-SHA256, sesje w D1, token w naglowku Authorization
const ITER = 100_000; // max, jaki pozwala Cloudflare Workers
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

async function pbkdf2(password, salt, iterations, bytes = 32) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, bytes * 8));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${toHex(salt)}$${toHex(await pbkdf2(password, salt, ITER))}`;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password, stored) {
  const [alg, iter, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'pbkdf2' || !saltHex || !hashHex) return false;
  const expected = fromHex(hashHex);
  return sameBytes(await pbkdf2(password, fromHex(saltHex), Number(iter), expected.length), expected);
}

// Hash dla nieistniejacego loginu, zeby czas odpowiedzi nie zdradzal czy login istnieje
const DUMMY = `pbkdf2$${ITER}$${'00'.repeat(16)}$${'00'.repeat(32)}`;
export const dummyHash = () => DUMMY;

export function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Hasło musi mieć min. 10 znaków';
  if (password.length > 200) return 'Hasło jest za długie';
  return null;
}

const sha256 = async (s) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export async function createSession(env, adminId) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Date.now() + (Number(env.SESSION_HOURS) || 12) * 3600_000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), adminId, expires),
  ]);
  return { token, expires };
}

function bearer(request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{64})$/);
  return m ? m[1] : null;
}

export async function getSessionAdmin(env, request) {
  const token = bearer(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`SELECT a.id, a.username, s.expires_at FROM sessions s JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ?`).bind(tokenHash).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, username: row.username, tokenHash };
}

export async function destroySession(env, request) {
  const token = bearer(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

// Limit: 8 nieudanych prob na 15 minut z jednego IP
const WINDOW = 15 * 60_000;
export async function loginLimited(env, ip) {
  const r = await env.DB.prepare('SELECT count, reset_at FROM login_attempts WHERE ip = ?').bind(ip).first();
  return !!r && r.reset_at > Date.now() && r.count >= 8;
}
export async function loginFailed(env, ip) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE reset_at < ?').bind(now),
    env.DB.prepare(`INSERT INTO login_attempts (ip, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(ip) DO UPDATE SET count = count + 1`).bind(ip, now + WINDOW),
  ]);
}
export async function loginSucceeded(env, ip) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}
