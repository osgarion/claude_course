/**
 * Přímý test SAMOTNÉ pojistky, ne cesty k ní.
 *
 * Testy v stock.test.ts můžou procházet jen díky předběžné kontrole skladu
 * ve fázi A (createOrder), aniž by kdy sáhly na CHECK constraint. Ten je
 * přitom to jediné, co drží data v pořádku při skutečném souběhu - proto se
 * musí ověřit zvlášť, obejitím předběžné kontroly.
 *
 * Kdyby někdo z schématu CHECK (stock >= 0) odstranil, tyhle testy spadnou.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { makeProduct, resetDb } from "../helpers.js";

beforeEach(() => resetDb());

describe("CHECK (stock >= 0) jako poslední pojistka", () => {
  it("odečet pod nulu selže, i když ho pošleme přímo do DB", async () => {
    const product = await makeProduct({ stock: 1 });

    await expect(
      env.DB.prepare(`UPDATE products SET stock = stock - 5 WHERE id = ?`).bind(product.id).run(),
    ).rejects.toThrow(/CHECK constraint failed/);

    const fresh = await env.DB.prepare(`SELECT stock FROM products WHERE id = ?`)
      .bind(product.id)
      .first<any>();
    expect(fresh.stock).toBe(1);
  });

  it("selhaný odečet vrátí zpět CELÝ batch (i vloženou objednávku)", async () => {
    // Přesně scénář souběhu: fáze A viděla dost zboží, ale než doběhl batch,
    // někdo jiný sklad vyprázdnil. Musí spadnout úplně všechno, ne jen ten
    // jeden UPDATE - jinak by vznikla objednávka bez odečteného skladu.
    const product = await makeProduct({ stock: 1 });
    const address = await env.DB.prepare(
      `INSERT INTO addresses (user_id, full_name, street, city, postal_code, country)
       VALUES (NULL, 'Host', 'Ulice 1', 'Praha', '10000', 'CZ') RETURNING *`,
    ).first<any>();

    const orderId = crypto.randomUUID();
    const now = new Date().toISOString();

    await expect(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO orders (id, user_id, shipping_address_id, status, subtotal_cents,
                               discount_cents, total_cents, created_at, updated_at)
           VALUES (?, NULL, ?, 'pending', 1000, 0, 1000, ?, ?)`,
        ).bind(orderId, address.id, now, now),
        // tenhle odečet přeteče pod nulu -> celý batch musí padnout
        env.DB.prepare(`UPDATE products SET stock = stock - 3 WHERE id = ?`).bind(product.id),
        env.DB.prepare(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
           VALUES (?, ?, 3, 1000)`,
        ).bind(orderId, product.id),
      ]),
    ).rejects.toThrow(/CHECK constraint failed/);

    const orders = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders`).first<any>();
    const items = await env.DB.prepare(`SELECT COUNT(*) AS n FROM order_items`).first<any>();
    const fresh = await env.DB.prepare(`SELECT stock FROM products WHERE id = ?`)
      .bind(product.id)
      .first<any>();

    expect(orders.n).toBe(0); // objednávka se NEsmí uložit
    expect(items.n).toBe(0);
    expect(fresh.stock).toBe(1); // sklad netknutý
  });

  it("podmíněný UPDATE by nestačil - proto ho nepoužíváme", async () => {
    // Dokumentační test: UPDATE, který netrefí žádný řádek, NENÍ chyba,
    // takže by batch v klidu commitnul objednávku bez odečtu skladu.
    // Právě proto stojí bezpečnost na CHECK constraintu, a ne na WHERE.
    const product = await makeProduct({ stock: 1 });

    const result = await env.DB.prepare(
      `UPDATE products SET stock = stock - 5 WHERE id = ? AND stock >= 5`,
    )
      .bind(product.id)
      .run();

    expect(result.success).toBe(true); // žádná výjimka!
    expect(result.meta.changes).toBe(0); // jen tiše nic neudělal
  });
});
