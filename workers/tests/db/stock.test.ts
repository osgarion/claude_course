/**
 * Skladová bezpečnost - nejdůležitější testy celého přepisu.
 *
 * D1 nemá SELECT FOR UPDATE, takže atomicitu drží CHECK (stock >= 0) uvnitř
 * db.batch(). Kdyby někdo ten constraint ze schématu odstranil nebo přepsal
 * odečet na podmíněný UPDATE, tyhle testy musí spadnout.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { OrderError, cancelOrder, createOrder } from "../../src/services/order.js";
import { makeAddress, makeProduct, makeUser, resetDb } from "../helpers.js";

beforeEach(() => resetDb());

describe("založení objednávky", () => {
  it("odečte sklad", async () => {
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const product = await makeProduct({ stock: 5, price_cents: 20000 });

    await createOrder(env.DB, user, {
      items: [{ product: product.id, quantity: 2 }],
      shipping_address: address.id,
    });

    const fresh = await env.DB.prepare(`SELECT stock FROM products WHERE id = ?`)
      .bind(product.id)
      .first<any>();
    expect(fresh.stock).toBe(3);
  });

  it("odmítne objednávku nad rámec skladu", async () => {
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const product = await makeProduct({ stock: 2 });

    await expect(
      createOrder(env.DB, user, {
        items: [{ product: product.id, quantity: 5 }],
        shipping_address: address.id,
      }),
    ).rejects.toThrow(OrderError);

    const fresh = await env.DB.prepare(`SELECT stock FROM products WHERE id = ?`)
      .bind(product.id)
      .first<any>();
    expect(fresh.stock).toBe(2);
  });

  it("při nedostatku u JEDNÉ položky se vrátí zpět CELÁ objednávka", async () => {
    // Tohle je ten scénář, kvůli kterému existuje CHECK constraint: bez něj
    // by se první produkt odečetl a druhý ne, a zůstal by nekonzistentní stav.
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const plenty = await makeProduct({ name: "Dost skladem", stock: 10 });
    const scarce = await makeProduct({ name: "Skoro došlo", stock: 1 });

    await expect(
      createOrder(env.DB, user, {
        items: [
          { product: plenty.id, quantity: 3 },
          { product: scarce.id, quantity: 5 },
        ],
        shipping_address: address.id,
      }),
    ).rejects.toThrow(OrderError);

    const plentyFresh = await env.DB.prepare(`SELECT stock FROM products WHERE id = ?`)
      .bind(plenty.id)
      .first<any>();
    const orders = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders`).first<any>();
    const items = await env.DB.prepare(`SELECT COUNT(*) AS n FROM order_items`).first<any>();

    expect(plentyFresh.stock).toBe(10); // nedotčeno
    expect(orders.n).toBe(0);
    expect(items.n).toBe(0);
  });

  it("dva souběžné nákupy posledního kusu: projde právě jeden", async () => {
    const buyerA = await makeUser({ email: "a@example.com" });
    const buyerB = await makeUser({ email: "b@example.com" });
    const addressA = await makeAddress(buyerA.id);
    const addressB = await makeAddress(buyerB.id);
    const product = await makeProduct({ name: "Poslední kus", stock: 1 });

    const results = await Promise.allSettled([
      createOrder(env.DB, buyerA, {
        items: [{ product: product.id, quantity: 1 }],
        shipping_address: addressA.id,
      }),
      createOrder(env.DB, buyerB, {
        items: [{ product: product.id, quantity: 1 }],
        shipping_address: addressB.id,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const fresh = await env.DB.prepare(`SELECT stock FROM products WHERE id = ?`)
      .bind(product.id)
      .first<any>();
    expect(fresh.stock).toBe(0); // nikdy ne -1

    const orders = await env.DB.prepare(`SELECT COUNT(*) AS n FROM orders`).first<any>();
    expect(orders.n).toBe(1);
  });

  it("varianta se odečítá ze skladu varianty, ne produktu", async () => {
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const product = await makeProduct({ stock: 7, price_cents: 20000 });
    const variant = await env.DB.prepare(
      `INSERT INTO product_variants (product_id, name, sku, price_override_cents, stock)
       VALUES (?, 'XL', 'SKU-XL', 25000, 3) RETURNING *`,
    )
      .bind(product.id)
      .first<any>();

    const orderId = await createOrder(env.DB, user, {
      items: [{ product: product.id, variant: variant.id, quantity: 2 }],
      shipping_address: address.id,
    });

    const freshVariant = await env.DB.prepare(`SELECT stock FROM product_variants WHERE id = ?`)
      .bind(variant.id)
      .first<any>();
    const freshProduct = await env.DB.prepare(`SELECT stock FROM products WHERE id = ?`)
      .bind(product.id)
      .first<any>();
    const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<any>();

    expect(freshVariant.stock).toBe(1);
    expect(freshProduct.stock).toBe(7); // sklad produktu netknutý
    expect(order.subtotal_cents).toBe(50000); // 2 × cena varianty (250,00)
  });

  it("odmítne variantu patřící jinému produktu", async () => {
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const productA = await makeProduct({ name: "Produkt A", price_cents: 100000 });
    const productB = await makeProduct({ name: "Produkt B", price_cents: 1000 });
    const cheapVariant = await env.DB.prepare(
      `INSERT INTO product_variants (product_id, name, sku, price_override_cents, stock)
       VALUES (?, 'levná', 'SKU-B', 500, 10) RETURNING *`,
    )
      .bind(productB.id)
      .first<any>();

    // pokus koupit drahý produkt A za cenu varianty produktu B
    await expect(
      createOrder(env.DB, user, {
        items: [{ product: productA.id, variant: cheapVariant.id, quantity: 1 }],
        shipping_address: address.id,
      }),
    ).rejects.toThrow(OrderError);
  });
});

describe("zrušení objednávky", () => {
  it("vrátí zboží na sklad", async () => {
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const product = await makeProduct({ stock: 5 });

    const orderId = await createOrder(env.DB, user, {
      items: [{ product: product.id, quantity: 2 }],
      shipping_address: address.id,
    });
    const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<any>();

    await cancelOrder(env.DB, order);

    const fresh = await env.DB.prepare(`SELECT stock FROM products WHERE id = ?`)
      .bind(product.id)
      .first<any>();
    expect(fresh.stock).toBe(5);
  });

  it("dvojí zrušení nevrátí sklad dvakrát", async () => {
    // Bez "zabrání" přechodu stavu podmíněným UPDATEm by druhé zrušení
    // přičetlo zboží znovu a vykouzlilo kusy, které neexistují.
    const user = await makeUser();
    const address = await makeAddress(user.id);
    const product = await makeProduct({ stock: 5 });

    const orderId = await createOrder(env.DB, user, {
      items: [{ product: product.id, quantity: 2 }],
      shipping_address: address.id,
    });
    const order = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<any>();

    await cancelOrder(env.DB, order);
    await expect(cancelOrder(env.DB, order)).rejects.toThrow(OrderError);

    const fresh = await env.DB.prepare(`SELECT stock FROM products WHERE id = ?`)
      .bind(product.id)
      .first<any>();
    expect(fresh.stock).toBe(5); // ne 7
  });
});
