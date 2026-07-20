import { Hono } from "hono";

import { createStripeClient, handleWebhookEvent } from "../services/stripe.js";
import type { AppEnv } from "../types.js";

const stripeWebhook = new Hono<AppEnv>();

/**
 * Volá Stripe, ne uživatel - žádné auth ani rate limit. Hranice důvěry je
 * ověření podpisu uvnitř handleWebhookEvent(), ne token.
 */
stripeWebhook.post("/webhook", async (c) => {
  if (!c.env.STRIPE_WEBHOOK_SECRET) {
    return c.json({ detail: "Webhook není nakonfigurovaný." }, 503);
  }

  // RAW text, ne parsované JSON - podpis se počítá z přesných bajtů těla.
  const rawBody = await c.req.text();
  const signature = c.req.header("stripe-signature") ?? "";
  const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);

  const result = await handleWebhookEvent(stripe, c.env.DB, rawBody, signature, c.env.STRIPE_WEBHOOK_SECRET);
  return c.json(result.body, result.status as any);
});

export default stripeWebhook;
