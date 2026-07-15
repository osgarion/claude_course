/**
 * Stripe logika (paymentIntentFor / handleWebhookEvent) proti reálné D1, ale
 * s ručně napsaným StripeClient fakem - žádné síťové volání na Stripe API.
 * Stejný DI vzor jako tests/db/chat_tools.test.ts.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { markOrderPaid, createOrder } from "../../src/services/order.js";
import { handleWebhookEvent, paymentIntentFor, type StripeClient } from "../../src/services/stripe.js";
import { makeAddress, makeProduct, makeUser, resetDb } from "../helpers.js";

beforeEach(() => resetDb());

function fakeStripeClient(overrides: Partial<{
  createResult: any;
  retrieveResult: any;
  webhookEvent: any;
  webhookError: boolean;
}> = {}): StripeClient & { createCalls: any[]; retrieveCalls: string[] } {
  const createCalls: any[] = [];
  const retrieveCalls: string[] = [];
  return {
    createCalls,
    retrieveCalls,
    paymentIntents: {
      create: async (params) => {
        createCalls.push(params);
        return overrides.createResult ?? { id: "pi_new", client_secret: "pi_new_secret", status: "requires_payment_method" };
      },
      retrieve: async (id) => {
        retrieveCalls.push(id);
        return overrides.retrieveResult ?? { id, client_secret: `${id}_secret`, status: "requires_payment_method" };
      },
    },
    webhooks: {
      constructEventAsync: async () => {
        if (overrides.webhookError) throw new Error("neplatný podpis");
        return overrides.webhookEvent;
      },
    },
  };
}

async function orderFor(user: any) {
  const address = await makeAddress(user.id);
  const product = await makeProduct({ stock: 10, price_cents: 50000 });
  const orderId = await createOrder(env.DB, user, {
    items: [{ product: product.id, quantity: 1 }],
    shipping_address: address.id,
  });
  return env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<any>();
}

describe("paymentIntentFor", () => {
  it("založí nový intent, když objednávka žádný nemá, a uloží jeho id", async () => {
    const user = await makeUser();
    const order = await orderFor(user);
    const stripe = fakeStripeClient({ createResult: { id: "pi_abc", client_secret: "pi_abc_secret", status: "requires_payment_method" } });

    const intent = await paymentIntentFor(stripe, env.DB, order, "czk");

    expect(intent.id).toBe("pi_abc");
    expect(stripe.createCalls).toHaveLength(1);
    expect(stripe.createCalls[0]).toMatchObject({ amount: 50000, currency: "czk", metadata: { order_id: order.id } });

    const fresh = await env.DB.prepare(`SELECT payment_intent_id FROM orders WHERE id = ?`).bind(order.id).first<any>();
    expect(fresh.payment_intent_id).toBe("pi_abc");
  });

  it("znovupoužije nedokončený intent, nezaloží nový", async () => {
    const user = await makeUser();
    const order = await orderFor(user);
    await env.DB.prepare(`UPDATE orders SET payment_intent_id = ? WHERE id = ?`).bind("pi_old", order.id).run();
    order.payment_intent_id = "pi_old";

    const stripe = fakeStripeClient({ retrieveResult: { id: "pi_old", client_secret: "pi_old_secret", status: "requires_confirmation" } });

    const intent = await paymentIntentFor(stripe, env.DB, order, "czk");

    expect(intent.id).toBe("pi_old");
    expect(stripe.retrieveCalls).toEqual(["pi_old"]);
    expect(stripe.createCalls).toHaveLength(0);
  });

  it("založí nový intent, když ten starý už uspěl nebo byl zrušený", async () => {
    const user = await makeUser();
    const order = await orderFor(user);
    await env.DB.prepare(`UPDATE orders SET payment_intent_id = ? WHERE id = ?`).bind("pi_done", order.id).run();
    order.payment_intent_id = "pi_done";

    const stripe = fakeStripeClient({
      retrieveResult: { id: "pi_done", status: "succeeded" },
      createResult: { id: "pi_fresh", client_secret: "pi_fresh_secret", status: "requires_payment_method" },
    });

    const intent = await paymentIntentFor(stripe, env.DB, order, "czk");

    expect(intent.id).toBe("pi_fresh");
    expect(stripe.createCalls).toHaveLength(1);
  });
});

describe("handleWebhookEvent", () => {
  it("payment_intent.succeeded označí objednávku zaplacenou", async () => {
    const user = await makeUser();
    const order = await orderFor(user);
    const stripe = fakeStripeClient({
      webhookEvent: {
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_123", metadata: { order_id: order.id } } },
      },
    });

    const result = await handleWebhookEvent(stripe, env.DB, "raw-body", "sig", "whsec_test");

    expect(result.status).toBe(200);
    const fresh = await env.DB.prepare(`SELECT status FROM orders WHERE id = ?`).bind(order.id).first<any>();
    expect(fresh.status).toBe("paid");
    const payment = await env.DB.prepare(`SELECT * FROM payments WHERE order_id = ?`).bind(order.id).first<any>();
    expect(payment.provider).toBe("stripe");
    expect(payment.transaction_id).toBe("pi_123");
  });

  it("neznámá objednávka v metadatech je no-op, ale pořád vrátí 200", async () => {
    const stripe = fakeStripeClient({
      webhookEvent: {
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_999", metadata: { order_id: "neexistuje" } } },
      },
    });

    const result = await handleWebhookEvent(stripe, env.DB, "raw-body", "sig", "whsec_test");
    expect(result.status).toBe(200);

    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM payments`).first<any>();
    expect(count.n).toBe(0);
  });

  it("neplatný podpis vrátí 400, objednávku nezmění", async () => {
    const user = await makeUser();
    const order = await orderFor(user);
    const stripe = fakeStripeClient({ webhookError: true });

    const result = await handleWebhookEvent(stripe, env.DB, "raw-body", "spatny-podpis", "whsec_test");

    expect(result.status).toBe(400);
    const fresh = await env.DB.prepare(`SELECT status FROM orders WHERE id = ?`).bind(order.id).first<any>();
    expect(fresh.status).toBe("pending");
  });

  it("dvojité doručení stejné události nevytvoří druhou platbu", async () => {
    const user = await makeUser();
    const order = await orderFor(user);
    const stripe = fakeStripeClient({
      webhookEvent: {
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_dup", metadata: { order_id: order.id } } },
      },
    });

    await handleWebhookEvent(stripe, env.DB, "raw-body", "sig", "whsec_test");
    await handleWebhookEvent(stripe, env.DB, "raw-body", "sig", "whsec_test");

    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM payments WHERE order_id = ?`).bind(order.id).first<any>();
    expect(count.n).toBe(1);
  });

  it("ignoruje eventy jiného typu", async () => {
    const stripe = fakeStripeClient({ webhookEvent: { type: "payment_intent.created", data: { object: {} } } });
    const result = await handleWebhookEvent(stripe, env.DB, "raw-body", "sig", "whsec_test");
    expect(result.status).toBe(200);
  });
});

describe("markOrderPaid idempotence napříč Stripe cestami", () => {
  it("confirm_payment po webhooku (nebo naopak) nevytvoří druhou platbu", async () => {
    const user = await makeUser();
    const order = await orderFor(user);

    await markOrderPaid(env.DB, order, "stripe", "pi_first");
    // Druhé volání (jako by přišel webhook i confirm_payment skoro současně)
    const second = await markOrderPaid(env.DB, order, "stripe", "pi_second");

    expect(second.transaction_id).toBe("pi_first"); // první zápis vyhrává
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM payments WHERE order_id = ?`).bind(order.id).first<any>();
    expect(count.n).toBe(1);
  });
});
