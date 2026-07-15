-- Ukázková data "Pixel Pantry". Spustitelné opakovaně (INSERT OR IGNORE).
--
-- Admin účet se tu ZÁMĚRNĚ nezakládá: heslo nejde zahashovat v SQL. Založ ho
-- přes API a povyš na provozovatele:
--
--   curl -X POST https://<worker>.workers.dev/api/auth/register \
--        -H 'Content-Type: application/json' \
--        -d '{"email":"admin@example.com","password":"<zvol-silne-heslo>"}'
--
--   npx wrangler d1 execute pixel-pantry --remote \
--       --command "UPDATE users SET is_staff = 1 WHERE email = 'admin@example.com'"

INSERT OR IGNORE INTO categories (name, slug) VALUES
  ('Svačiny', 'svaciny'),
  ('Nápoje',  'napoje'),
  ('Gadgets', 'gadgets');

-- Ceny jsou v halířích: 4990 = 49,90 Kč
INSERT OR IGNORE INTO products (name, slug, category_id, price_cents, description, stock, created_at, updated_at)
SELECT 'Retro Gamer Chips', 'retro-gamer-chips', c.id, 4990,
       'Křupavé chipsy pro dlouhé herní noci.', 40,
       datetime('now'), datetime('now')
  FROM categories c WHERE c.slug = 'svaciny';

INSERT OR IGNORE INTO products (name, slug, category_id, price_cents, description, stock, created_at, updated_at)
SELECT 'Pixel Pop Popcorn', 'pixel-pop-popcorn', c.id, 3990,
       'Popcorn s příchutí nostalgie.', 25,
       datetime('now'), datetime('now')
  FROM categories c WHERE c.slug = 'svaciny';

INSERT OR IGNORE INTO products (name, slug, category_id, price_cents, description, stock, created_at, updated_at)
SELECT '8-Bit Energy Drink', '8-bit-energy-drink', c.id, 3490,
       'Energie na dalších osm bitů.', 60,
       datetime('now'), datetime('now')
  FROM categories c WHERE c.slug = 'napoje';

INSERT OR IGNORE INTO products (name, slug, category_id, price_cents, description, stock, created_at, updated_at)
SELECT 'Byte Size Cola', 'byte-size-cola', c.id, 2990,
       'Kolová limonáda v plechovce velikosti jednoho bytu.', 80,
       datetime('now'), datetime('now')
  FROM categories c WHERE c.slug = 'napoje';

INSERT OR IGNORE INTO products (name, slug, category_id, price_cents, description, stock, created_at, updated_at)
SELECT 'Mechanická klávesnice Mini', 'mechanicka-klavesnice-mini', c.id, 129900,
       'Kompaktní mechanická klávesnice s retro klávesami.', 8,
       datetime('now'), datetime('now')
  FROM categories c WHERE c.slug = 'gadgets';

INSERT OR IGNORE INTO products (name, slug, category_id, price_cents, description, stock, created_at, updated_at)
SELECT 'USB-C hub 6v1', 'usb-c-hub-6v1', c.id, 59900,
       'Šest portů, jeden kabel.', 15,
       datetime('now'), datetime('now')
  FROM categories c WHERE c.slug = 'gadgets';

-- Kupóny. 'percent' -> setiny procenta (1000 = 10,00 %)
--         'fixed'   -> halíře (5000 = sleva 50,00 Kč)
INSERT OR IGNORE INTO coupons (code, discount_type, value_cents, is_active, valid_to) VALUES
  ('WELCOME10', 'percent', 1000, 1, NULL),
  ('FLAT50',    'fixed',   5000, 1, NULL),
  -- záměrně expirovaný, ať jde vyzkoušet i odmítnutí
  ('EXPIRED10', 'percent', 1000, 1, '2020-01-01T00:00:00.000Z');
