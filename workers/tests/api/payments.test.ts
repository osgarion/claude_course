/**
 * Stripe endpointy přes plný request cyklus - jen cesty dosažitelné bez
 * reálného Stripe klíče (v testech je STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET
 * prázdný stejně jako ANTHROPIC_API_KEY). Logika s reálným PaymentIntentem
 * (reuse/create/webhook) má vlastní testy v tests/db/stripe.test.ts s
 * ručním StripeClient fakem - tady se nic nemockuje, žádné síťové volání.
 */
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { makeAddress, makeProduct, makeToken, makeUser, resetDb } from "../helpers.js";

beforeEach(() => resetDb());

const json = (body: unknown, token?: string) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Token ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

describe("POST /api/stripe/webhook", () => {
  it("v testech je STRIPE_WEBHOOK_SECRET prázdný (jinak by testy volaly placené API)", () => {
    expect(env.STRIPE_WEBHOOK_SECRET).toBeFalsy();
  });

  it("bez STRIPE_WEBHOOK_SECRET vrací 503, ne tichý pád", async () => {
    const response = await SELF.fetch("https://x/api/stripe/webhook", json({ type: "payment_intent.succeeded" }));
    expect(response.status).toBe(503);
  });
});

describe("POST /api/orders/:id/confirm_payment", () => {
  it("beze STRIPE_SECRET_KEY se objednávka bez payment_intent_id vrátí jako 400", async () => {
    // Bez klíče žádná objednávka payment_intent_id nemá (fake platba ho
    // nezakládá) - kontrola se stihne ještě před dotazem na Stripe.
    const user = await makeUser();
    const token = await makeToken(user.id);
    const address = await makeAddress(user.id);
    const product = await makeProduct({ stock: 5 });

    const created = await SELF.fetch(
      "https://x/api/orders/",
      json({ shipping_address: address.id, items: [{ product: product.id, quantity: 1 }] }, token),
    );
    const order = (await created.json()) as any;

    const response = await SELF.fetch(`https://x/api/orders/${order.id}/confirm_payment`, json({}, token));
    expect(response.status).toBe(400);
  });

  it("cizí objednávku nenajde (404, jako u pay/cancel)", async () => {
    const user = await makeUser();
    const token = await makeToken(user.id);
    const response = await SELF.fetch(
      `https://x/api/orders/00000000-0000-0000-0000-000000000000/confirm_payment`,
      json({}, token),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/orders/:id/pay (fake cesta beze změny)", () => {
  it("v testech je STRIPE_SECRET_KEY prázdný, takže platba zůstává fake", async () => {
    expect(env.STRIPE_SECRET_KEY).toBeFalsy();
  });
});
