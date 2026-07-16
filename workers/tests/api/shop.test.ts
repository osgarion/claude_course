/** Auth flow a průchod obchodem přes plný request cyklus. */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { makeAddress, makeCoupon, makeProduct, makeToken, makeUser, resetDb } from "../helpers.js";

beforeEach(() => resetDb());

const json = (body: unknown, token?: string) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Token ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

describe("registrace a přihlášení", () => {
  it("registrace vrátí token", async () => {
    const response = await SELF.fetch(
      "https://x/api/auth/register",
      json({ email: "novy@example.com", password: "velmi-tajne-heslo-1" }),
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(201);
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe("novy@example.com");
  });

  it("odmítne slabé heslo a duplicitní e-mail", async () => {
    const weak = await SELF.fetch(
      "https://x/api/auth/register",
      json({ email: "a@example.com", password: "123" }),
    );
    expect(weak.status).toBe(400);

    await makeUser({ email: "obsazeny@example.com" });
    const duplicate = await SELF.fetch(
      "https://x/api/auth/register",
      json({ email: "obsazeny@example.com", password: "velmi-tajne-heslo-1" }),
    );
    expect(duplicate.status).toBe(400);
  });

  it("/me vyžaduje přihlášení a vrátí přihlášeného uživatele", async () => {
    const anonymous = await SELF.fetch("https://x/api/auth/me");
    expect(anonymous.status).toBe(401);

    const user = await makeUser();
    const token = await makeToken(user.id);
    const response = await SELF.fetch("https://x/api/auth/me", {
      headers: { Authorization: `Token ${token}` },
    });
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(body.email).toBe(user.email);
  });

  it("logout zneplatní token", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);

    const logout = await SELF.fetch("https://x/api/auth/logout", json({}, token));
    expect(logout.status).toBe(204);

    const after = await SELF.fetch("https://x/api/auth/me", {
      headers: { Authorization: `Token ${token}` },
    });
    expect(after.status).toBe(401);
  });
});

describe("katalog", () => {
  it("hodnocení počítá jen schválené recenze", async () => {
    const product = await makeProduct({ name: "Sluchátka" });
    const userA = await makeUser({ email: "a@example.com" });
    const userB = await makeUser({ email: "b@example.com" });

    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO reviews (product_id, user_id, rating, is_approved, created_at)
           VALUES (?, ?, 4, 1, ?)`,
        )
        .bind(product.id, userA.id, new Date().toISOString()),
      env.DB
        .prepare(
          `INSERT INTO reviews (product_id, user_id, rating, is_approved, created_at)
           VALUES (?, ?, 1, 0, ?)`,
        )
        .bind(product.id, userB.id, new Date().toISOString()),
    ]);

    const response = await SELF.fetch(`https://x/api/products/${product.slug}`);
    const body = (await response.json()) as any;

    expect(body.avg_rating).toBe(4);
    expect(body.review_count).toBe(1);
    expect(body.reviews).toHaveLength(1); // neschválená se nezobrazí
  });

  it("produkt bez recenzí má avg_rating null, ne nulu", async () => {
    await makeProduct({ name: "Bez recenzí" });
    const response = await SELF.fetch("https://x/api/products/");
    const body = (await response.json()) as any[];

    expect(body[0].avg_rating).toBeNull();
    expect(body[0].review_count).toBe(0);
  });
});

describe("objednávka se slevovým kódem", () => {
  it("propíše slevu do totálů a vrátí ceny jako řetězce", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const address = await makeAddress(user.id);
    const product = await makeProduct({ price_cents: 20000, stock: 5 });
    await makeCoupon({ code: "SLEVA10", discount_type: "percent", value_cents: 1000 });

    const response = await SELF.fetch(
      "https://x/api/orders/",
      json(
        {
          shipping_address: address.id,
          coupon_code: "SLEVA10",
          items: [{ product: product.id, quantity: 2 }],
        },
        token,
      ),
    );
    const order = (await response.json()) as any;

    expect(response.status).toBe(201);
    expect(order.subtotal).toBe("400.00");
    expect(order.discount_amount).toBe("40.00");
    expect(order.total).toBe("360.00");
    expect(order.coupon).toBe("SLEVA10");
  });

  it("odmítne neplatný kód", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const address = await makeAddress(user.id);
    const product = await makeProduct({ stock: 5 });

    const response = await SELF.fetch(
      "https://x/api/orders/",
      json(
        {
          shipping_address: address.id,
          coupon_code: "NEEXISTUJE",
          items: [{ product: product.id, quantity: 1 }],
        },
        token,
      ),
    );
    expect(response.status).toBe(400);
  });
});

describe("platba", () => {
  it("dvojí zaplacení nevytvoří dvě platby", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const address = await makeAddress(user.id);
    const product = await makeProduct({ stock: 5 });

    const created = await SELF.fetch(
      "https://x/api/orders/",
      json({ shipping_address: address.id, items: [{ product: product.id, quantity: 1 }] }, token),
    );
    const order = (await created.json()) as any;

    const first = await SELF.fetch(`https://x/api/orders/${order.id}/pay`, json({}, token));
    const second = await SELF.fetch(`https://x/api/orders/${order.id}/pay`, json({}, token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200); // idempotentní, ne chyba

    const payments = await env.DB.prepare(`SELECT COUNT(*) AS n FROM payments`).first<any>();
    expect(payments.n).toBe(1);
  });
});
