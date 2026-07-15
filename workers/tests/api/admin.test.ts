/**
 * Admin endpointy - stejný vzor jako "zápis do katalogu jen pro provozovatele"
 * v security.test.ts: pro každý zapisovací endpoint jeden test s obyčejným
 * zákazníkem (403) a jeden se staffem (úspěch).
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { makeAddress, makeProduct, makeToken, makeUser, resetDb } from "../helpers.js";

beforeEach(() => resetDb());

const req = (method: string, token?: string, body?: unknown) => ({
  method,
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Token ${token}` } : {}),
  },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

describe("produkty - jen provozovatel", () => {
  it("běžný zákazník nesmí založit produkt", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const response = await SELF.fetch("https://x/api/products", req("POST", token, { name: "Test", price: "10.00" }));
    expect(response.status).toBe(403);
  });

  it("provozovatel smí založit, upravit i smazat produkt", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const token = await makeToken(staff.id);

    const created = await SELF.fetch(
      "https://x/api/products",
      req("POST", token, { name: "Testovací produkt", price: "199.00", stock: 5 }),
    );
    expect(created.status).toBe(201);
    const product = (await created.json()) as any;
    expect(product.price).toBe("199.00");

    const updated = await SELF.fetch(
      `https://x/api/products/${product.id}`,
      req("PATCH", token, { price: "149.00", is_active: false }),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as any).price).toBe("149.00");

    const deleted = await SELF.fetch(`https://x/api/products/${product.id}`, req("DELETE", token));
    expect(deleted.status).toBe(204);
  });

  it("?all=1 vrátí neaktivní produkty jen staffovi", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const staffToken = await makeToken(staff.id);
    const customer = await makeUser({ email: "zakaznik@example.com" });
    const customerToken = await makeToken(customer.id);

    const product = await makeProduct({ name: "Neaktivní" });
    await env.DB.prepare(`UPDATE products SET is_active = 0 WHERE id = ?`).bind(product.id).run();

    const asStaff = await SELF.fetch("https://x/api/products?all=1", req("GET", staffToken));
    expect(((await asStaff.json()) as any[]).some((p) => p.id === product.id)).toBe(true);

    const asCustomer = await SELF.fetch("https://x/api/products?all=1", req("GET", customerToken));
    expect(((await asCustomer.json()) as any[]).some((p) => p.id === product.id)).toBe(false);

    const anonymous = await SELF.fetch("https://x/api/products?all=1", req("GET"));
    expect(((await anonymous.json()) as any[]).some((p) => p.id === product.id)).toBe(false);
  });
});

describe("kupóny - celé jen provozovatel", () => {
  it("běžný zákazník nesmí ani vidět seznam kupónů", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const response = await SELF.fetch("https://x/api/coupons", req("GET", token));
    expect(response.status).toBe(403);
  });

  it("provozovatel smí založit, upravit i smazat kupón", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const token = await makeToken(staff.id);

    const created = await SELF.fetch(
      "https://x/api/coupons",
      req("POST", token, { code: "TESTCODE", discount_type: "percent", value: "15.00" }),
    );
    expect(created.status).toBe(201);
    const coupon = (await created.json()) as any;

    const updated = await SELF.fetch(
      `https://x/api/coupons/${coupon.id}`,
      req("PATCH", token, { is_active: false }),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as any).is_active).toBe(false);

    const list = await SELF.fetch("https://x/api/coupons", req("GET", token));
    expect(((await list.json()) as any[]).length).toBe(1);

    const deleted = await SELF.fetch(`https://x/api/coupons/${coupon.id}`, req("DELETE", token));
    expect(deleted.status).toBe(204);
  });
});

describe("objednávky - admin výpis a odeslání", () => {
  it("běžný zákazník nesmí na admin výpis objednávek", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const response = await SELF.fetch("https://x/api/orders/admin", req("GET", token));
    expect(response.status).toBe(403);
  });

  it("admin výpis vrátí objednávky napříč zákazníky (nezapadne do accessibleOrder jako ID)", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const staffToken = await makeToken(staff.id);
    const customer = await makeUser({ email: "zakaznik@example.com" });
    const customerToken = await makeToken(customer.id);
    const address = await makeAddress(customer.id);
    const product = await makeProduct({ stock: 5 });

    const created = await SELF.fetch(
      "https://x/api/orders",
      req("POST", customerToken, { shipping_address: address.id, items: [{ product: product.id, quantity: 1 }] }),
    );
    const order = (await created.json()) as any;

    const response = await SELF.fetch("https://x/api/orders/admin", req("GET", staffToken));
    expect(response.status).toBe(200);
    const orders = (await response.json()) as any[];
    expect(orders.some((o) => o.id === order.id && o.customer_email === "zakaznik@example.com")).toBe(true);
  });

  it("odeslání funguje jen ze stavu 'paid'", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const staffToken = await makeToken(staff.id);
    const customer = await makeUser({ email: "zakaznik@example.com" });
    const customerToken = await makeToken(customer.id);
    const address = await makeAddress(customer.id);
    const product = await makeProduct({ stock: 5 });

    const created = await SELF.fetch(
      "https://x/api/orders",
      req("POST", customerToken, { shipping_address: address.id, items: [{ product: product.id, quantity: 1 }] }),
    );
    const order = (await created.json()) as any;

    // Ještě pending - nejde odeslat.
    const tooEarly = await SELF.fetch(`https://x/api/orders/${order.id}/ship`, req("POST", staffToken));
    expect(tooEarly.status).toBe(400);

    await SELF.fetch(`https://x/api/orders/${order.id}/pay`, req("POST", customerToken, {}));

    const shipped = await SELF.fetch(`https://x/api/orders/${order.id}/ship`, req("POST", staffToken));
    expect(shipped.status).toBe(200);
    expect(((await shipped.json()) as any).status).toBe("shipped");
  });

  it("běžný zákazník nesmí odeslat objednávku", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const response = await SELF.fetch("https://x/api/orders/some-id/ship", req("POST", token));
    expect(response.status).toBe(403);
  });
});

describe("recenze - schválení jen provozovatel", () => {
  it("běžný zákazník nesmí schválit recenzi", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const response = await SELF.fetch("https://x/api/reviews/1", req("PATCH", token, { is_approved: true }));
    expect(response.status).toBe(403);
  });

  it("provozovatel smí přepnout is_approved", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const staffToken = await makeToken(staff.id);
    const customer = await makeUser({ email: "zakaznik@example.com" });
    const customerToken = await makeToken(customer.id);
    const product = await makeProduct();

    const created = await SELF.fetch(
      `https://x/api/products/${product.id}/reviews`,
      req("POST", customerToken, { rating: 5, comment: "Super!" }),
    );
    const review = (await created.json()) as any;
    expect(review.is_approved).toBe(false);

    const response = await SELF.fetch(
      `https://x/api/reviews/${review.id}`,
      req("PATCH", staffToken, { is_approved: true }),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).is_approved).toBe(true);
  });
});
