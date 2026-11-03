-- Czat z klientami, zamowienia z nickiem, limity zapytan

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  nick TEXT NOT NULL,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',          -- notatka admina, np. co ktos chce kupic
  unread_admin INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_conversations_last ON conversations(last_message_at DESC);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('user', 'admin', 'ai', 'system')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,              -- publiczny numer do sprawdzania statusu
  nick TEXT NOT NULL,
  lines_json TEXT NOT NULL,               -- [{type, name, qty, prices}] - ceny z chwili zamowienia
  total_json TEXT NOT NULL,               -- [{currency, amount}] razem z doplata
  express INTEGER NOT NULL DEFAULT 0,
  express_fee_json TEXT NOT NULL DEFAULT '[]',
  customer_note TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done', 'cancelled')),
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX idx_orders_nick ON orders(nick COLLATE NOCASE);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('express_enabled', '1'),
  ('express_fee_amount', '5'),
  ('express_fee_currency', 'Iron Ingot'),
  ('ai_enabled', '1'),
  ('admin_seen', '0');
