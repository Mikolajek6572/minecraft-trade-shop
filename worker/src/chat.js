// Czat klient <-> admin (+ asystent AI). Klient ma losowy token rozmowy, w bazie tylko jego hash.
import { HttpError } from './catalog.js';
import { getSettings, rateLimit, validNick, text, randomHex, sha256 } from './shop.js';
import { reply as aiReply } from './assistant.js';

const msgView = (m) => ({ id: m.id, sender: m.sender, body: m.body, createdAt: m.created_at });

export async function conversationFromRequest(db, request) {
  const token = request.headers.get('X-Chat-Token') || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT * FROM conversations WHERE token_hash = ?').bind(await sha256(token)).first();
}

async function requireConversation(db, request) {
  const conv = await conversationFromRequest(db, request);
  if (!conv) throw new HttpError(401, 'Rozmowa wygasła. Zacznij nową');
  return conv;
}

async function insertMessage(db, convId, sender, body, { unread = false } = {}) {
  const now = Date.now();
  const [ins] = await db.batch([
    db.prepare('INSERT INTO messages (conversation_id, sender, body, created_at) VALUES (?, ?, ?, ?) RETURNING *').bind(convId, sender, body, now),
    db.prepare(`UPDATE conversations SET last_message_at = ?, unread_admin = unread_admin + ? WHERE id = ?`).bind(now, unread ? 1 : 0, convId),
  ]);
  return msgView(ins.results[0]);
}

export const addSystemMessage = (db, convId, body) => insertMessage(db, convId, 'system', body, { unread: true });
export const addAiMessage = (db, convId, body) => insertMessage(db, convId, 'ai', body);

// ---------- klient ----------
export async function startChat(env, body, clientIp) {
  const db = env.DB;
  await rateLimit(db, `chatstart:${clientIp}`, 6, 3600_000, 'Za dużo nowych rozmów. Spróbuj później');
  const nick = validNick(body.nick);
  const token = randomHex(32);
  const now = Date.now();
  const settings = await getSettings(db);
  const conv = await db.prepare(`INSERT INTO conversations (token_hash, nick, ai_enabled, last_message_at, created_at)
    VALUES (?, ?, ?, ?, ?) RETURNING id`).bind(await sha256(token), nick, settings.aiEnabled ? 1 : 0, now, now).first();
  await insertMessage(db, conv.id, settings.aiEnabled ? 'ai' : 'system', settings.aiEnabled
    ? `Cześć ${nick}! Jestem asystentem sklepu. Zapytaj mnie o ceny albo jak zamówić. Admin też czyta ten czat i odpisze, gdy będzie dostępny.`
    : `Cześć ${nick}! Napisz wiadomość – admin odpowie najszybciej, jak się da.`);
  return { token, nick };
}

async function chatState(db, conv) {
  const settings = await getSettings(db);
  return { nick: conv.nick, aiActive: !!conv.ai_enabled && settings.aiEnabled, adminOnline: settings.adminOnline };
}

export async function getMessages(env, request, after) {
  const db = env.DB;
  const conv = await requireConversation(db, request);
  const { results } = await db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id LIMIT 200')
    .bind(conv.id, Number(after) || 0).all();
  return { ...(await chatState(db, conv)), messages: results.map(msgView) };
}

export async function sendMessage(env, request, body, clientIp, ctx) {
  const db = env.DB;
  const conv = await requireConversation(db, request);
  const msg = text(body.body, 'Wiadomość', 800);
  if (!msg) throw new HttpError(400, 'Wiadomość jest pusta');
  await rateLimit(db, `chatmsg:${conv.id}`, 20, 5 * 60_000, 'Za szybko piszesz. Odczekaj chwilę');
  await rateLimit(db, `chatip:${clientIp}`, 40, 5 * 60_000, 'Za szybko piszesz. Odczekaj chwilę');
  const message = await insertMessage(db, conv.id, 'user', msg, { unread: true });
  const state = await chatState(db, conv);
  if (state.aiActive) ctx.waitUntil(aiReply(env, conv.id));
  return { ...state, message, aiThinking: state.aiActive };
}

// ---------- admin ----------
export async function listConversations(db) {
  const { results } = await db.prepare(`SELECT c.id, c.nick, c.ai_enabled, c.note, c.unread_admin, c.last_message_at, c.created_at,
      (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
      (SELECT sender FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender
    FROM conversations c ORDER BY c.last_message_at DESC LIMIT 200`).all();
  return results.map((c) => ({
    id: c.id, nick: c.nick, aiEnabled: !!c.ai_enabled, note: c.note, unread: c.unread_admin,
    lastMessageAt: c.last_message_at, createdAt: c.created_at, lastBody: c.last_body, lastSender: c.last_sender,
  }));
}

export async function adminConversation(db, id) {
  const conv = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  if (!conv) throw new HttpError(404, 'Nie ma takiej rozmowy');
  const [msgs] = await db.batch([
    db.prepare('SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 300) ORDER BY id').bind(id),
    db.prepare('UPDATE conversations SET unread_admin = 0 WHERE id = ?').bind(id),
  ]);
  return {
    id: conv.id, nick: conv.nick, aiEnabled: !!conv.ai_enabled, note: conv.note, createdAt: conv.created_at,
    messages: msgs.results.map(msgView),
  };
}

export async function adminSend(db, id, body) {
  const msg = text(body.body, 'Wiadomość', 2000);
  if (!msg) throw new HttpError(400, 'Wiadomość jest pusta');
  if (!(await db.prepare('SELECT 1 FROM conversations WHERE id = ?').bind(id).first())) throw new HttpError(404, 'Nie ma takiej rozmowy');
  // Admin przejmuje rozmowe - asystent milknie (mozna go wlaczyc z powrotem)
  await db.prepare('UPDATE conversations SET ai_enabled = 0 WHERE id = ?').bind(id).run();
  return insertMessage(db, id, 'admin', msg);
}

export async function updateConversation(db, id, body) {
  const conv = await db.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  if (!conv) throw new HttpError(404, 'Nie ma takiej rozmowy');
  const ai = body.aiEnabled === undefined ? conv.ai_enabled : (body.aiEnabled ? 1 : 0);
  const note = body.note === undefined ? conv.note : text(body.note, 'Notatka', 1000);
  await db.prepare('UPDATE conversations SET ai_enabled = ?, note = ? WHERE id = ?').bind(ai, note, id).run();
  return true;
}

export async function deleteConversation(db, id) {
  return (await db.prepare('DELETE FROM conversations WHERE id = ?').bind(id).run()).meta.changes > 0;
}
