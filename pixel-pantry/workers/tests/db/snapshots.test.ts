/**
 * Objednávka je HISTORIE, ne pohled do katalogu.
 *
 * Položka objednávky snapshotuje název i cenu v okamžiku nákupu. Kdyby někdo
 * snapshot odstranil a nechal položku číst název přes JOIN na products,
 * přejmenování produktu by zpětně přepsalo, co si zákazník podle objednávky
 * koupil - a smazání produktu by objednávku rozbilo úplně.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { createOrder } from "../../src/services/order.js";
import { makeAddress, makeProduct, makeUser, resetDb } from "../helpers.js";

beforeEach(() => resetDb());

async function itemsOf(orderId: string) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM order_items WHERE order_id = ?`,
  )
    .bind(orderId)
    .all<any>();
  return results ?? [];
}

describe("snapshot položky objednávky", () => {
  it("uloží název a cenu produktu v době nákupu", async () => {
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const product = await makeProduct({ name: "Pixelový hrnek", price_cents: 24900 });

    const orderId = await createOrder(env.DB, user, {
      items: [{ product: product.id, quantity: 1 }],
      shipping_address: address.id,
    });

    const [item] = await itemsOf(orderId);
    expect(item.product_name).toBe("Pixelový hrnek");
    expect(item.unit_price_cents).toBe(24900);
  });

  it("přejmenování produktu nepřepíše historickou objednávku", async () => {
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const product = await makeProduct({ name: "Pixelový hrnek", price_cents: 24900 });

    const orderId = await createOrder(env.DB, user, {
      items: [{ product: product.id, quantity: 1 }],
      shipping_address: address.id,
    });

    await env.DB.prepare(`UPDATE products SET name = ?, price_cents = ? WHERE id = ?`)
      .bind("Úplně jiný hrnek", 99900, product.id)
      .run();

    const [item] = await itemsOf(orderId);
    expect(item.product_name).toBe("Pixelový hrnek");
    expect(item.unit_price_cents).toBe(24900);
  });

  it("smazání produktu z katalogu objednávku nesmaže ani nerozbije", async () => {
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const product = await makeProduct({ name: "Pixelový hrnek" });

    const orderId = await createOrder(env.DB, user, {
      items: [{ product: product.id, quantity: 1 }],
      shipping_address: address.id,
    });

    // Dřív tady byl ON DELETE RESTRICT, takže tohle vůbec nešlo.
    await env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(product.id).run();

    const [item] = await itemsOf(orderId);
    expect(item.product_id).toBeNull();
    expect(item.product_name).toBe("Pixelový hrnek");
  });

  it("varianta se do názvu propíše taky", async () => {
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const product = await makeProduct({ name: "Tričko", price_cents: 30000 });
    const variant = await env.DB.prepare(
      `INSERT INTO product_variants (product_id, name, sku, stock) VALUES (?, 'L', 'TRIKO-L', 5)
       RETURNING *`,
    )
      .bind(product.id)
      .first<any>();

    const orderId = await createOrder(env.DB, user, {
      items: [{ product: product.id, variant: variant.id, quantity: 1 }],
      shipping_address: address.id,
    });

    const [item] = await itemsOf(orderId);
    expect(item.product_name).toBe("Tričko - L");
  });
});
