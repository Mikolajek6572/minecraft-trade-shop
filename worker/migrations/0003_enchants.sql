-- Enchanty: mozna je dodac do przedmiotu w koszyku albo kupic jako ksiege
CREATE TABLE enchants (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  max_level INTEGER NOT NULL DEFAULT 1 CHECK (max_level BETWEEN 1 AND 10),
  book INTEGER NOT NULL DEFAULT 1,            -- 1 = mozna kupic jako ksiege z enchantem
  item_ids TEXT NOT NULL DEFAULT '[]',        -- JSON: do ktorych przedmiotow mozna go dodac
  note TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);

-- Cena za JEDEN poziom (Protection IV = 4x ta cena)
CREATE TABLE enchant_prices (
  id INTEGER PRIMARY KEY,
  enchant_id INTEGER NOT NULL REFERENCES enchants(id) ON DELETE CASCADE,
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  sort INTEGER NOT NULL DEFAULT 0
);

-- Startowe enchanty (12-15 = diamentowa zbroja)
INSERT INTO enchants (id, name, max_level, book, item_ids, sort) VALUES
  (1, 'Protection', 4, 1, '[12,13,14,15]', 0),
  (2, 'Unbreaking', 3, 1, '[12,13,14,15]', 1),
  (3, 'Mending', 1, 1, '[12,13,14,15]', 2),
  (4, 'Feather Falling', 4, 1, '[15]', 3),
  (5, 'Sharpness', 5, 1, '[]', 4),
  (6, 'Efficiency', 5, 1, '[]', 5),
  (7, 'Fortune', 3, 1, '[]', 6);

INSERT INTO enchant_prices (enchant_id, currency, amount) VALUES
  (1, 'Iron Ingot', 3),
  (2, 'Iron Ingot', 4),
  (3, 'Diamond', 2),
  (4, 'Iron Ingot', 2),
  (5, 'Iron Ingot', 3),
  (6, 'Iron Ingot', 3),
  (7, 'Diamond', 1);
