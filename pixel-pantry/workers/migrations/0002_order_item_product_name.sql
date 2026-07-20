-- Objednávka je HISTORIE, ne pohled do katalogu.
--
-- Dřív položka držela jen `unit_price_cents` a odkazovala na produkt přes
-- ON DELETE RESTRICT - což znamenalo, že produkt, který si někdo koupil, už
-- nikdy nešlo z katalogu smazat, a přejmenování produktu zpětně přepsalo, co
-- si zákazník podle své objednávky myslel, že koupil.
--
-- Nově se název snapshotuje do `product_name` a vazba na produkt smí zmizet
-- (SET NULL). Objednávka tak přežije smazání i přejmenování produktu.
--
-- SQLite neumí změnit cizí klíč přes ALTER TABLE, takže tabulku přestavujeme.
-- Nic jiného na order_items neodkazuje, takže je to bezpečné.

CREATE TABLE order_items_new (
  id               INTEGER PRIMARY KEY,
  order_id         TEXT    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- NULL = produkt byl mezitím z katalogu smazán; položka žije dál díky snapshotu
  product_id       INTEGER NULL REFERENCES products(id) ON DELETE SET NULL,
  variant_id       INTEGER NULL REFERENCES product_variants(id) ON DELETE SET NULL,
  -- snapshot názvu i ceny v době objednávky - pozdější změna katalogu
  -- nesmí přepsat historii
  product_name     TEXT    NOT NULL DEFAULT '',
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL
);

INSERT INTO order_items_new (id, order_id, product_id, variant_id, product_name, quantity, unit_price_cents)
SELECT oi.id, oi.order_id, oi.product_id, oi.variant_id,
       -- doplnění názvu pro objednávky založené před touto migrací
       COALESCE(p.name, ''), oi.quantity, oi.unit_price_cents
  FROM order_items oi
  LEFT JOIN products p ON p.id = oi.product_id;

DROP TABLE order_items;
ALTER TABLE order_items_new RENAME TO order_items;

CREATE INDEX idx_order_items_order ON order_items(order_id);
