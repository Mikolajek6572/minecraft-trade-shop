// API Minecraft Trade Shop: cennik, logowanie admina, panel, ikony
import * as catalog from './catalog.js';
import * as auth from './auth.js';

const { HttpError } = catalog;

function allowedOrigin(env, request) {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function cors(env, request, isPublic) {
  const origin = allowedOrigin(env, request);
  const h = { 'Vary': 'Origin' };
  if (origin) Object.assign(h, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  });
  else if (isPublic) h['Access-Control-Allow-Origin'] = '*';
  return h;
}

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...headers },
});

async function readBody(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) throw new HttpError(415, 'Wymagany JSON');
  const text = await request.text();
  if (text.length > 50_000) throw new HttpError(413, 'Za duże zapytanie');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Zły JSON'); }
}

function parseId(s) {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Złe id');
  return n;
}

// ---------- ikony z Minecraft Wiki, trzymane w cache Cloudflare ----------
async function icon(request, ctx, name) {
  if (!/^[A-Za-z0-9_'()\-]{1,64}$/.test(name)) return new Response(null, { status: 400 });
  const cache = caches.default;
  const key = new Request(new URL(request.url).origin + '/icons/' + name + '.png');
  const hit = await cache.match(key);
  if (hit) return hit;

  let res;
  const r = await fetch(`https://minecraft.wiki/w/Special:FilePath/Invicon_${encodeURIComponent(name)}.png`, {
    headers: { 'User-Agent': 'MinecraftTradeShop/1.0 (icon cache)' }, redirect: 'follow',
  }).catch(() => null);
  if (r && r.ok && /^image\/(png|gif|webp)/.test(r.headers.get('Content-Type') || '')) {
    res = new Response(r.body, { headers: {
      'Content-Type': r.headers.get('Content-Type'),
      'Cache-Control': 'public, max-age=604800',
      'Access-Control-Allow-Origin': '*',
    } });
  } else {
    res = new Response(null, { status: 404, headers: { 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' } });
  }
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ---------- trasy ----------
const adminResources = {
  items: [catalog.saveItem, catalog.deleteItem],
  categories: [catalog.saveCategory, catalog.deleteCategory],
  bundles: [catalog.saveBundle, catalog.deleteBundle],
};

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const db = env.DB;

  if (method === 'GET' && path === '/') return json({ name: 'Minecraft Trade Shop API', ok: true });

  const iconMatch = path.match(/^\/icons\/(.+)\.png$/);
  if (method === 'GET' && iconMatch) return icon(request, ctx, decodeURIComponent(iconMatch[1]));

  if (method === 'GET' && path === '/api/catalog') return json(await catalog.getCatalog(db), 200, { 'Cache-Control': 'no-cache' });

  // Wszystko ponizej tylko z dozwolonych stron (GitHub Pages / lokalnie)
  if (!allowedOrigin(env, request)) throw new HttpError(403, 'Niedozwolona strona');

  if (method === 'POST' && path === '/api/auth/login') {
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (await auth.loginLimited(env, ip)) throw new HttpError(429, 'Za dużo prób. Spróbuj za 15 minut');
    const body = await readBody(request);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const admin = username && await db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?').bind(username).first();
    const ok = await auth.verifyPassword(String(body.password || ''), admin ? admin.password_hash : auth.dummyHash());
    if (!admin || !ok) {
      await auth.loginFailed(env, ip);
      throw new HttpError(401, 'Zły login lub hasło');
    }
    await auth.loginSucceeded(env, ip);
    const { token, expires } = await auth.createSession(env, admin.id);
    return json({ username: admin.username, token, expires });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    await auth.destroySession(env, request);
    return json({ ok: true });
  }

  const admin = await auth.getSessionAdmin(env, request);
  if (!admin) throw new HttpError(401, 'Zaloguj się ponownie');

  if (method === 'GET' && path === '/api/auth/me') return json({ username: admin.username });

  if (method === 'POST' && path === '/api/auth/password') {
    const { current, next } = await readBody(request);
    const row = await db.prepare('SELECT password_hash FROM admins WHERE id = ?').bind(admin.id).first();
    if (!(await auth.verifyPassword(String(current || ''), row.password_hash))) throw new HttpError(400, 'Obecne hasło jest złe');
    const err = auth.checkPasswordStrength(next);
    if (err) throw new HttpError(400, err);
    await db.batch([
      db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').bind(await auth.hashPassword(next), admin.id),
      // Wylogowanie innych sesji
      db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?').bind(admin.id, admin.tokenHash),
    ]);
    return json({ ok: true });
  }

  if (method === 'GET' && path === '/api/admin/catalog') return json(await catalog.getCatalog(db, { includeHidden: true }));

  if (method === 'PUT' && path === '/api/admin/settings') {
    await catalog.saveSettings(db, await readBody(request));
    return json({ ok: true });
  }

  // Kazdy typ danych: POST = dodaj, PUT = edytuj, DELETE = usun
  const m = path.match(/^\/api\/admin\/(items|categories|bundles)(?:\/([^/]+))?$/);
  if (m) {
    const [save, remove] = adminResources[m[1]];
    if (method === 'POST' && !m[2]) return json({ id: await save(db, null, await readBody(request)) }, 201);
    if (method === 'PUT' && m[2]) return json({ id: await save(db, parseId(m[2]), await readBody(request)) });
    if (method === 'DELETE' && m[2]) return (await remove(db, parseId(m[2]))) ? json({ ok: true }) : json({ error: 'Nie znaleziono' }, 404);
  }

  throw new HttpError(404, 'Nie ma takiego adresu');
}

export default {
  async fetch(request, env, ctx) {
    const isPublic = request.method === 'GET' && (request.url.includes('/api/catalog') || request.url.includes('/icons/'));
    const corsHeaders = cors(env, request, isPublic);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    let res;
    try {
      res = await route(request, env, ctx);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      res = json({ error: status >= 500 ? 'Błąd serwera' : e.message }, status);
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders)) out.headers.set(k, v);
    return out;
  },
};
