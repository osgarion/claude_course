/**
 * Bezpečnostní invarianty přes plný request cyklus.
 *
 * Nejdůležitější je past "None == None" / "undefined === undefined":
 * objednávka hosta má user_id NULL a anonymní request nemá uživatele.
 * Naivní kontrola vlastnictví by je prohlásila za shodné a pustila kohokoli
 * k cizí objednávce. Django verze na tuhle past narazila; tady se hlídá.
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { makeAddress, makeProduct, makeToken, makeUser, resetDb } from "../helpers.js";

beforeEach(() => resetDb());

const guestOrderBody = (productId: number) => ({
  shipping_address_input: {
    full_name: "Host Zákazník",
    street: "Ulice 1",
    city: "Praha",
    postal_code: "10000",
    country: "Česko",
  },
  items: [{ product: productId, quantity: 1 }],
});

async function createGuestOrder() {
  const product = await makeProduct({ stock: 5 });
  const response = await SELF.fetch("https://x/api/orders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(guestOrderBody(product.id)),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as any;
}

describe("objednávky hosta", () => {
  it("host může objednat bez přihlášení a dostane guest_token", async () => {
    const order = await createGuestOrder();
    expect(order.guest_token).toBeTruthy();
  });

  it("se správným tokenem svou objednávku uvidí", async () => {
    const order = await createGuestOrder();
    const response = await SELF.fetch(`https://x/api/orders/${order.id}?token=${order.guest_token}`);
    expect(response.status).toBe(200);
  });

  it("BEZ tokenu nedostane nic (past undefined === undefined)", async () => {
    const order = await createGuestOrder();
    const response = await SELF.fetch(`https://x/api/orders/${order.id}`);
    expect(response.status).toBe(404);
  });

  it("se ŠPATNÝM tokenem nedostane nic", async () => {
    const order = await createGuestOrder();
    const response = await SELF.fetch(
      `https://x/api/orders/${order.id}?token=00000000-0000-0000-0000-000000000000`,
    );
    expect(response.status).toBe(404);
  });

  it("přihlášený cizí uživatel se k objednávce hosta nedostane ani s tokenem", async () => {
    const order = await createGuestOrder();
    const intruder = await makeUser({ email: "vetrelec@example.com" });
    const token = await makeToken(intruder.id);

    const response = await SELF.fetch(`https://x/api/orders/${order.id}?token=${order.guest_token}`, {
      headers: { Authorization: `Token ${token}` },
    });
    // přihlášená větev rozhoduje POUZE podle vlastnictví, token ignoruje
    expect(response.status).toBe(404);
  });

  it("host nemůže zaplatit ani zrušit cizí objednávku bez tokenu", async () => {
    const order = await createGuestOrder();

    const pay = await SELF.fetch(`https://x/api/orders/${order.id}/pay`, { method: "POST" });
    const cancel = await SELF.fetch(`https://x/api/orders/${order.id}/cancel`, { method: "POST" });

    expect(pay.status).toBe(404);
    expect(cancel.status).toBe(404);
  });
});

describe("cizí záznamy vrací 404, ne 403", () => {
  it("cizí adresa", async () => {
    const owner = await makeUser({ email: "vlastnik@example.com" });
    const address = await makeAddress(owner.id);
    const intruder = await makeUser({ email: "vetrelec@example.com" });
    const token = await makeToken(intruder.id);

    const response = await SELF.fetch(`https://x/api/addresses/${address.id}`, {
      headers: { Authorization: `Token ${token}` },
    });

    // 403 by prozradilo, že adresa s tímhle ID existuje
    expect(response.status).toBe(404);
  });

  it("cizí objednávka přihlášeného uživatele", async () => {
    const owner = await makeUser({ email: "vlastnik@example.com" });
    const ownerToken = await makeToken(owner.id);
    const address = await makeAddress(owner.id);
    const product = await makeProduct({ stock: 5 });

    const created = await SELF.fetch("https://x/api/orders/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Token ${ownerToken}` },
      body: JSON.stringify({
        shipping_address: address.id,
        items: [{ product: product.id, quantity: 1 }],
      }),
    });
    const order = (await created.json()) as any;

    const intruder = await makeUser({ email: "vetrelec@example.com" });
    const intruderToken = await makeToken(intruder.id);
    const response = await SELF.fetch(`https://x/api/orders/${order.id}`, {
      headers: { Authorization: `Token ${intruderToken}` },
    });

    expect(response.status).toBe(404);
  });
});

describe("anonym nesmí použít cizí adresu podle ID", () => {
  it("host nemůže přilepit na objednávku existující adresu jiného uživatele", async () => {
    // Tohle je mezera, kterou má Django verze otevřenou (kontrolu vlastnictví
    // adresy dělá jen pro přihlášené) - tady je vědomě zavřená.
    const owner = await makeUser();
    const address = await makeAddress(owner.id);
    const product = await makeProduct({ stock: 5 });

    const response = await SELF.fetch("https://x/api/orders/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shipping_address: address.id,
        items: [{ product: product.id, quantity: 1 }],
      }),
    });

    expect(response.status).toBe(400);
  });
});

describe("zápis do katalogu jen pro provozovatele", () => {
  it("běžný zákazník nesmí zakládat kategorie", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);

    const response = await SELF.fetch("https://x/api/categories/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
      body: JSON.stringify({ name: "Nová kategorie" }),
    });

    expect(response.status).toBe(403);
  });

  it("provozovatel (is_staff) smí", async () => {
    const staff = await makeUser({ email: "owner@example.com", is_staff: 1 });
    const token = await makeToken(staff.id);

    const response = await SELF.fetch("https://x/api/categories/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
      body: JSON.stringify({ name: "Nová kategorie" }),
    });

    expect(response.status).toBe(201);
  });
});
