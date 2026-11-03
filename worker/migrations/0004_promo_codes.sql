-- Kody promocyjne: -X% od ceny przedmiotow (bez doplaty za natychmiastowa dostawe)
CREATE TABLE promo_codes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  percent INTEGER NOT NULL CHECK (percent BETWEEN 1 AND 90),
  expires_at INTEGER,                 -- ms; NULL = bez konca
  max_uses INTEGER,                   -- NULL = bez limitu
  uses INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  public INTEGER NOT NULL DEFAULT 0,  -- 1 = baner z kodem na stronie
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

ALTER TABLE orders ADD COLUMN promo_code TEXT;
ALTER TABLE orders ADD COLUMN promo_percent INTEGER;
ALTER TABLE orders ADD COLUMN subtotal_json TEXT;  -- suma przedmiotow przed rabatem

-- SWIETA2026: -30% do konca 20 lutego 2027 (czasu polskiego)
INSERT INTO promo_codes (code, percent, expires_at, active, public, note, created_at)
  VALUES ('SWIETA2026', 30, 1803164399000, 1, 1, 'Promocja świąteczna', 1793750400000);
