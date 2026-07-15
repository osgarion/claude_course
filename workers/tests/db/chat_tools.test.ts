/**
 * Nástroje chatbota proti reálné D1.
 *
 * Tohle je bezpečnostní jádro chatu: model NESMÍ mít jak se dostat k cizím
 * datům, i kdyby ho konverzace přesvědčila, že má. Netestujeme tedy, jestli
 * model "poslechne" systémový prompt (to by byl test modelu), ale jestli
 * nástroje cizí data VŮBEC UMÍ vrátit. Nesmí.
 *
 * Samotné volání Anthropic API se tu nemockuje - nástroje voláme přímo.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { buildTools } from "../../src/services/assistant.js";
import { createOrder } from "../../src/services/order.js";
import type { AuthUser } from "../../src/types.js";
import { makeAddress, makeCoupon, makeProduct, makeUser, resetDb } from "../helpers.js";

beforeEach(() => resetDb());

/**
 * Minimální náhrada Hono kontextu. Podstatné je, že uživatel jde z `user`
 * (v ostrém provozu z ověřeného tokenu) a guest token z hlavičky requestu -
 * model do žádného z nich nevidí.
 */
function fakeContext(user: AuthUser | null, guestToken?: string) {
  return {
    env: { DB: env.DB },
    get: (key: string) => (key === "user" ? user : null),
    req: {
      query: (key: string) => (key === "token" ? guestToken : undefined),
      header: (key: string) => (key === "X-Guest-Token" ? guestToken : undefined),
    },
  } as any;
}

function tool(user: AuthUser | null, name: string, guestToken?: string) {
  return buildTools(fakeContext(user, guestToken)).find((t) => t.name === name);
}

async function run(user: AuthUser | null, name: string, args: any = {}, guestToken?: string) {
  const found = tool(user, name, guestToken);
  if (!found) throw new Error(`nástroj ${name} není v nabídce`);
  return JSON.parse((await found.run(args)) as string);
}

describe("nabídka nástrojů", () => {
  it("nepřihlášený nemá nástroj na vlastní objednávky vůbec v nabídce", async () => {
    const names = buildTools(fakeContext(null)).map((t) => t.name);
    expect(names).not.toContain("list_my_orders");
    expect(names).toContain("search_products");
  });

  it("přihlášený ho v nabídce má", async () => {
    const user = await makeUser();
    expect(buildTools(fakeContext(user)).map((t) => t.name)).toContain("list_my_orders");
  });

  it("žádné schéma nástroje nebere identitu zákazníka jako parametr", async () => {
    const user = await makeUser();
    for (const t of buildTools(fakeContext(user))) {
      const fields = Object.keys((t as any).input_schema?.properties ?? {});
      expect(fields).not.toContain("user");
      expect(fields).not.toContain("user_id");
      expect(fields).not.toContain("email");
    }
  });
});

describe("search_products", () => {
  it("najde produkt podle názvu", async () => {
    await makeProduct({ name: "Pixelový hrnek", price_cents: 24900, stock: 3 });
    const result = await run(null, "search_products", { query: "hrnek" });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ name: "Pixelový hrnek", price: "249.00", in_stock: 3 });
  });

  it("neaktivní produkt nenabídne", async () => {
    const product = await makeProduct({ name: "Stažený hrnek" });
    await env.DB.prepare(`UPDATE products SET is_active = 0 WHERE id = ?`).bind(product.id).run();

    const result = await run(null, "search_products", { query: "hrnek" });
    expect(result.results).toHaveLength(0);
  });
});

describe("check_coupon", () => {
  it("potvrdí platný kód", async () => {
    await makeCoupon({ code: "SLEVA10", discount_type: "percent", value_cents: 1000 });
    expect(await run(null, "check_coupon", { code: "SLEVA10" })).toEqual({
      valid: true,
      discount_type: "percent",
      value: "10.00",
    });
  });

  it("neexistující kód je neplatný", async () => {
    expect(await run(null, "check_coupon", { code: "NEEXISTUJE" })).toEqual({ valid: false });
  });
});

describe("list_my_orders", () => {
  it("nikdy nevrátí objednávku jiného zákazníka", async () => {
    const alice = await makeUser({ email: "alice@example.com" });
    const bob = await makeUser({ email: "bob@example.com" });
    const product = await makeProduct({ stock: 10 });

    const bobsOrder = await createOrder(env.DB, bob, {
      items: [{ product: product.id, quantity: 1 }],
      shipping_address: (await makeAddress(bob.id)).id,
    });

    // Alice se ptá na svoje objednávky - Bobova mezi nimi být nesmí.
    const result = await run(alice, "list_my_orders");
    expect(result.orders).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(bobsOrder);
  });

  it("vrátí vlastní objednávky", async () => {
    const user = await makeUser();
    const product = await makeProduct({ stock: 10 });
    const orderId = await createOrder(env.DB, user, {
      items: [{ product: product.id, quantity: 1 }],
      shipping_address: (await makeAddress(user.id)).id,
    });

    const result = await run(user, "list_my_orders");
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].id).toBe(orderId);
  });
});

describe("get_order_status", () => {
  it("cizí objednávku nenajde, i když model zná její ID", async () => {
    const alice = await makeUser({ email: "alice@example.com" });
    const bob = await makeUser({ email: "bob@example.com" });
    const product = await makeProduct({ stock: 10 });

    const bobsOrder = await createOrder(env.DB, bob, {
      items: [{ product: product.id, quantity: 1 }],
      shipping_address: (await makeAddress(bob.id)).id,
    });

    // Přesně scénář prompt injection: útočník modelu podstrčí cizí UUID.
    // Tool ho nesmí najít - ne proto, že by odmítl, ale protože dotaz
    // vždycky nese `user_id` přihlášeného.
    const result = await run(alice, "get_order_status", { order_id: bobsOrder });
    expect(result.error).toBeTruthy();
    expect(result.status).toBeUndefined();
  });

  it("anonym bez guest tokenu nedostane nic", async () => {
    const user = await makeUser();
    const product = await makeProduct({ stock: 10 });
    const orderId = await createOrder(env.DB, user, {
      items: [{ product: product.id, quantity: 1 }],
      shipping_address: (await makeAddress(user.id)).id,
    });

    const result = await run(null, "get_order_status", { order_id: orderId });
    expect(result.error).toBeTruthy();
  });

  it("vlastní objednávku vrátí i se snapshotem názvu", async () => {
    const user = await makeUser();
    const product = await makeProduct({ name: "Pixelový hrnek", stock: 10, price_cents: 24900 });
    const orderId = await createOrder(env.DB, user, {
      items: [{ product: product.id, quantity: 2 }],
      shipping_address: (await makeAddress(user.id)).id,
    });

    const result = await run(user, "get_order_status", { order_id: orderId });
    expect(result.status).toBe("pending");
    expect(result.items).toEqual([
      { product: "Pixelový hrnek", quantity: 2, unit_price: "249.00" },
    ]);
    expect(result.total).toBe("498.00");
  });
});
