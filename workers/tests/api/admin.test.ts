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

describe("uživatelé - správa jen provozovatel", () => {
  it("běžný zákazník nesmí na výpis ani úpravu uživatelů", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    expect((await SELF.fetch("https://x/api/admin/users", req("GET", token))).status).toBe(403);
    expect((await SELF.fetch(`https://x/api/admin/users/${user.id}`, req("PATCH", token, { is_staff: true }))).status).toBe(403);
  });

  it("provozovatel vidí seznam, hledá a přepíná role/aktivitu", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const staffToken = await makeToken(staff.id);
    const customer = await makeUser({ email: "zakaznik@example.com" });

    const list = await SELF.fetch("https://x/api/admin/users", req("GET", staffToken));
    expect(((await list.json()) as any[]).length).toBe(2);

    const search = await SELF.fetch("https://x/api/admin/users?search=zakaznik", req("GET", staffToken));
    const found = (await search.json()) as any[];
    expect(found.length).toBe(1);
    expect(found[0].email).toBe("zakaznik@example.com");

    const patched = await SELF.fetch(
      `https://x/api/admin/users/${customer.id}`,
      req("PATCH", staffToken, { is_staff: true, is_active: false }),
    );
    expect(patched.status).toBe(200);
    const updated = (await patched.json()) as any;
    expect(updated.is_staff).toBe(true);
    expect(updated.is_active).toBe(false);
  });

  it("provozovatel si nesmí sám odebrat práva ani se deaktivovat", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const staffToken = await makeToken(staff.id);

    const demote = await SELF.fetch(`https://x/api/admin/users/${staff.id}`, req("PATCH", staffToken, { is_staff: false }));
    expect(demote.status).toBe(400);

    const deactivate = await SELF.fetch(`https://x/api/admin/users/${staff.id}`, req("PATCH", staffToken, { is_active: false }));
    expect(deactivate.status).toBe(400);
  });
});

describe("obrázky produktů - jen provozovatel", () => {
  it("běžný zákazník nesmí přidat obrázek", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const product = await makeProduct();
    const response = await SELF.fetch(
      `https://x/api/products/${product.id}/images`,
      req("POST", token, { image_url: "https://example.com/a.png" }),
    );
    expect(response.status).toBe(403);
  });

  it("provozovatel přidá, vypíše i smaže obrázek; is_primary je vždy jen jeden", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const token = await makeToken(staff.id);
    const product = await makeProduct();

    const first = await SELF.fetch(
      `https://x/api/products/${product.id}/images`,
      req("POST", token, { image_url: "https://example.com/a.png", is_primary: true }),
    );
    expect(first.status).toBe(201);
    const firstImg = (await first.json()) as any;

    const second = await SELF.fetch(
      `https://x/api/products/${product.id}/images`,
      req("POST", token, { image_url: "https://example.com/b.png", is_primary: true }),
    );
    const secondImg = (await second.json()) as any;

    const list = await SELF.fetch(`https://x/api/products/${product.id}/images`, req("GET", token));
    const images = (await list.json()) as any[];
    expect(images.length).toBe(2);
    // Nový primární shodil ten předchozí - primární je právě jeden.
    expect(images.filter((i) => i.is_primary).length).toBe(1);
    expect(images.find((i) => i.id === secondImg.id).is_primary).toBe(true);
    expect(images.find((i) => i.id === firstImg.id).is_primary).toBe(false);

    const deleted = await SELF.fetch(`https://x/api/products/${product.id}/images/${firstImg.id}`, req("DELETE", token));
    expect(deleted.status).toBe(204);
  });

  it("cizí kombinace produkt/obrázek vrátí 404 (nepotvrzuj existenci)", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const token = await makeToken(staff.id);
    const productA = await makeProduct({ name: "A" });
    const productB = await makeProduct({ name: "B" });

    const created = await SELF.fetch(
      `https://x/api/products/${productA.id}/images`,
      req("POST", token, { image_url: "https://example.com/a.png" }),
    );
    const img = (await created.json()) as any;

    const response = await SELF.fetch(`https://x/api/products/${productB.id}/images/${img.id}`, req("DELETE", token));
    expect(response.status).toBe(404);
  });
});

describe("objednávky - admin filtry, detail, hromadné odeslání", () => {
  async function paidOrder(customerToken: string, addressId: number, productId: number) {
    const created = await SELF.fetch(
      "https://x/api/orders",
      req("POST", customerToken, { shipping_address: addressId, items: [{ product: productId, quantity: 1 }] }),
    );
    const order = (await created.json()) as any;
    await SELF.fetch(`https://x/api/orders/${order.id}/pay`, req("POST", customerToken, {}));
    return order;
  }

  it("filtr podle stavu a detail přes JOIN", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const staffToken = await makeToken(staff.id);
    const customer = await makeUser({ email: "zakaznik@example.com" });
    const customerToken = await makeToken(customer.id);
    const address = await makeAddress(customer.id);
    const product = await makeProduct({ stock: 10 });

    const paid = await paidOrder(customerToken, address.id, product.id);

    const paidList = await SELF.fetch("https://x/api/orders/admin?status=paid", req("GET", staffToken));
    expect(((await paidList.json()) as any[]).every((o) => o.status === "paid")).toBe(true);

    const pendingList = await SELF.fetch("https://x/api/orders/admin?status=pending", req("GET", staffToken));
    expect(((await pendingList.json()) as any[]).length).toBe(0);

    const detail = await SELF.fetch(`https://x/api/orders/admin/${paid.id}`, req("GET", staffToken));
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as any).customer_email).toBe("zakaznik@example.com");

    const missing = await SELF.fetch("https://x/api/orders/admin/does-not-exist", req("GET", staffToken));
    expect(missing.status).toBe(404);
  });

  it("hromadné odeslání odešle jen 'paid'", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const staffToken = await makeToken(staff.id);
    const customer = await makeUser({ email: "zakaznik@example.com" });
    const customerToken = await makeToken(customer.id);
    const address = await makeAddress(customer.id);
    const product = await makeProduct({ stock: 10 });

    const paid1 = await paidOrder(customerToken, address.id, product.id);
    const paid2 = await paidOrder(customerToken, address.id, product.id);
    // Třetí zůstane pending (nezaplacená).
    const pendingCreated = await SELF.fetch(
      "https://x/api/orders",
      req("POST", customerToken, { shipping_address: address.id, items: [{ product: product.id, quantity: 1 }] }),
    );
    const pending = (await pendingCreated.json()) as any;

    const response = await SELF.fetch(
      "https://x/api/orders/admin/bulk-ship",
      req("POST", staffToken, { ids: [paid1.id, paid2.id, pending.id] }),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as any).shipped).toBe(2);
  });

  it("běžný zákazník nesmí na bulk-ship", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const response = await SELF.fetch("https://x/api/orders/admin/bulk-ship", req("POST", token, { ids: [] }));
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
