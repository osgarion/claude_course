-- Pixel Pantry - počáteční schéma (port z Django `catalog` app).
--
-- Tři věci se oproti Djangu záměrně liší, protože D1 nemá interaktivní
-- transakce ani SELECT FOR UPDATE:
--
-- 1) PENÍZE jsou INTEGER v halířích (4990 = 49,90 Kč). SQLite nemá decimal
--    typ a REAL by u peněz zaokrouhloval. API je na výstupu převádí zpět
--    na řetězce ("49.90"), takže se formát odpovědi nemění.
--
-- 2) CHECK (stock >= 0) je NOSNÝ BEZPEČNOSTNÍ PRVEK, ne kosmetika.
--    Objednávka se zakládá jedním db.batch() (= SQL transakce). Odečet
--    skladu je nepodmíněný `stock = stock - ?`; pokud by šel do mínusu,
--    databáze vyhodí constraint violation a CELÝ batch se vrátí zpět.
--    Tím je souběžný nákup posledního kusu bezpečný bez zamykání řádků.
--    (Podmíněný `WHERE stock >= ?` by nestačil - UPDATE, který netrefí
--    žádný řádek, není chyba a batch by v klidu commitnul.)
--
-- 3) orders.id je TEXT UUID, ne autoincrement. ID objednávky musíme znát
--    UŽ PŘED sestavením batche (položky na něj odkazují) a v batchi nejde
--    přečíst výsledek předchozího statementu. Bonus: cizí ID objednávek
--    nejdou uhodnout.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  -- COLLATE NOCASE dává zadarmo Django chování email__iexact
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  -- formát "pbkdf2_sha256$<iterace>$<b64 sůl>$<b64 hash>" - počet iterací
  -- je v záznamu, takže ho jde zvýšit bez zneplatnění starých hesel
  password      TEXT    NOT NULL,
  first_name    TEXT    NOT NULL DEFAULT '',
  last_name     TEXT    NOT NULL DEFAULT '',
  -- role "provozovatel obchodu" (Django is_staff)
  is_staff      INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  date_joined   TEXT    NOT NULL
);

-- Náhrada DRF authtoken. Ukládáme jen sha256 tokenu, nikdy holý token -
-- únik databáze pak neprozradí živé přihlášení (DRF ho drží v plaintextu).
-- Na rozdíl od DRF povolujeme víc tokenů na uživatele (víc zařízení);
-- logout maže jen ten předložený.
CREATE TABLE auth_tokens (
  key_hash   TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);

CREATE TABLE categories (
  id   INTEGER PRIMARY KEY,
  name TEXT    NOT NULL,
  slug TEXT    NOT NULL UNIQUE
);

CREATE TABLE products (
  id           INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL UNIQUE,
  category_id  INTEGER NULL REFERENCES categories(id) ON DELETE SET NULL,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  description  TEXT    NOT NULL DEFAULT '',
  image_url    TEXT    NOT NULL DEFAULT '',
  stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),  -- viz pozn. 2
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);
CREATE INDEX idx_products_active   ON products(is_active);
CREATE INDEX idx_products_category ON products(category_id);

-- Nahrávání souborů je etapa 2 (Workers nemají filesystem -> R2),
-- zatím jen URL na už hotový obrázek.
CREATE TABLE product_images (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url  TEXT    NOT NULL,
  alt_text   TEXT    NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_images_product ON product_images(product_id);

CREATE TABLE product_variants (
  id                   INTEGER PRIMARY KEY,
  product_id           INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name                 TEXT    NOT NULL,
  sku                  TEXT    NOT NULL UNIQUE,
  -- NULL = použij cenu produktu. 0 je platná cena (zdarma), ne "žádná cena"!
  price_override_cents INTEGER NULL CHECK (price_override_cents IS NULL OR price_override_cents >= 0),
  stock                INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0)  -- viz pozn. 2
);
CREATE INDEX idx_product_variants_product ON product_variants(product_id);

CREATE TABLE coupons (
  id            INTEGER PRIMARY KEY,
  code          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  discount_type TEXT    NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  -- 'fixed'   -> halíře (5000 = sleva 50,00 Kč)
  -- 'percent' -> setiny procenta (1000 = 10,00 %)
  value_cents   INTEGER NOT NULL CHECK (value_cents >= 0),
  is_active     INTEGER NOT NULL DEFAULT 1,
  valid_from    TEXT    NULL,
  valid_to      TEXT    NULL
);

CREATE TABLE addresses (
  id          INTEGER PRIMARY KEY,
  -- NULL = adresa hosta (objednávka bez účtu)
  user_id     INTEGER NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name   TEXT    NOT NULL,
  street      TEXT    NOT NULL,
  city        TEXT    NOT NULL,
  postal_code TEXT    NOT NULL,
  country     TEXT    NOT NULL,
  phone       TEXT    NOT NULL DEFAULT '',
  is_default  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_addresses_user ON addresses(user_id);

CREATE TABLE orders (
  id                  TEXT    PRIMARY KEY,  -- UUID, viz pozn. 3
  user_id             INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  shipping_address_id INTEGER NOT NULL REFERENCES addresses(id) ON DELETE RESTRICT,
  status              TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
  coupon_id           INTEGER NULL REFERENCES coupons(id) ON DELETE SET NULL,
  subtotal_cents      INTEGER NOT NULL DEFAULT 0,
  discount_cents      INTEGER NOT NULL DEFAULT 0,
  total_cents         INTEGER NOT NULL DEFAULT 0,
  payment_intent_id   TEXT    NOT NULL DEFAULT '',  -- nevyužité v etapě 1, čeká na Stripe
  -- Jen pro objednávky bez přihlášení. Host se jím prokazuje při
  -- zobrazení/platbě/zrušení. POZOR: přístup hosta NIKDY neurčuje
  -- "user_id IS NULL", vždy jen shoda tohoto tokenu (viz src/db/orders.ts).
  guest_token         TEXT    NULL UNIQUE,
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL
);
CREATE INDEX idx_orders_user ON orders(user_id);

CREATE TABLE order_items (
  id               INTEGER PRIMARY KEY,
  order_id         TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id       INTEGER NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  -- snapshot ceny v době objednávky - pozdější změna ceny produktu
  -- nesmí přepsat historii
  unit_price_cents INTEGER NOT NULL
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE payments (
  id             INTEGER PRIMARY KEY,
  order_id       TEXT    NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  amount_cents   INTEGER NOT NULL,
  method         TEXT    NOT NULL CHECK (method IN ('card', 'bank_transfer', 'cash_on_delivery')),
  status         TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'completed', 'failed')),
  provider       TEXT    NOT NULL DEFAULT 'fake',  -- 'stripe' přijde v etapě 2
  transaction_id TEXT    NOT NULL DEFAULT '',
  paid_at        TEXT    NULL
);

CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT    NOT NULL DEFAULT '',
  is_approved INTEGER NOT NULL DEFAULT 0,  -- moderace ownerem
  created_at  TEXT    NOT NULL,
  UNIQUE (product_id, user_id)
);
CREATE INDEX idx_reviews_product_approved ON reviews(product_id, is_approved);
