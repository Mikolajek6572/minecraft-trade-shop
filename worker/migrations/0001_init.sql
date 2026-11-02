-- Schemat bazy. Nowe funkcje = nowy plik 0002_*.sql, stare dane zostaja.
CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  icon TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  icon TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Kilka wierszy dla jednego przedmiotu = kilka przedmiotow w cenie
CREATE TABLE item_prices (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_item_prices_item ON item_prices(item_id);

CREATE TABLE bundles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bundle_items (
  bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  PRIMARY KEY (bundle_id, item_id)
);

CREATE TABLE bundle_prices (
  id INTEGER PRIMARY KEY,
  bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE admins (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- W bazie tylko hash tokenu sesji
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------- dane startowe ----------
INSERT INTO settings (key, value) VALUES ('shop_name', 'Minecraft Trade Shop');

INSERT INTO categories (id, name, sort) VALUES
  (1, 'Bloki', 0), (2, 'Surowce', 1), (3, 'Jedzenie', 2), (4, 'Narzędzia', 3), (5, 'Zbroja', 4);

INSERT INTO items (id, name, category_id, sort) VALUES
  (1, 'Oak Log', 1, 0),
  (2, 'Iron Ingot', 2, 1),
  (3, 'Cooked Beef', 3, 2),
  (4, 'Bucket', 4, 3),
  (5, 'Water Bucket', 4, 4),
  (6, 'Lava Bucket', 4, 5),
  (7, 'Cobblestone', 1, 6),
  (8, 'Stone', 1, 7),
  (9, 'Glass', 1, 8),
  (10, 'Raw Copper', 2, 9),
  (11, 'Diamond', 2, 10),
  (12, 'Diamond Helmet', 5, 11),
  (13, 'Diamond Chestplate', 5, 12),
  (14, 'Diamond Leggings', 5, 13),
  (15, 'Diamond Boots', 5, 14);

INSERT INTO item_prices (item_id, currency, amount) VALUES
  (1, 'Cobblestone', 2),
  (2, 'Cobblestone', 26),
  (3, 'Oak Log', 2),
  (4, 'Iron Ingot', 3),
  (5, 'Iron Ingot', 4),
  (6, 'Iron Ingot', 8),
  (7, 'Dirt', 2),
  (8, 'Dirt', 5),
  (9, 'Dirt', 6),
  (10, 'Dirt', 3),
  (11, 'Iron Ingot', 14),
  (12, 'Diamond', 5),
  (13, 'Diamond', 8),
  (14, 'Diamond', 7),
  (15, 'Diamond', 4);

INSERT INTO bundles (id, name, description, icon) VALUES
  (1, 'Diamentowy set', 'Komplet diamentowej zbroi: hełm, napierśnik, spodnie i buty.', 'mc:Diamond_Chestplate');
INSERT INTO bundle_items (bundle_id, item_id, qty) VALUES (1, 12, 1), (1, 13, 1), (1, 14, 1), (1, 15, 1);
INSERT INTO bundle_prices (bundle_id, currency, amount) VALUES (1, 'Diamond', 22);
