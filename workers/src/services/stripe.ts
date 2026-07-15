/**
 * Stripe platby: založení/znovupoužití PaymentIntentu a zpracování webhooku.
 *
 * DI stejně jako zbytek order.ts - business logika bere `StripeClient` jako
 * parametr (úzké rozhraní, ne celé Stripe SDK), takže testy mají jednoduchý
 * ruční fake a nikdy nevolají skutečné Stripe API. Jediné místo, které se
 * dotýká reálného `stripe` balíčku, je `createStripeClient()`.
 */
import Stripe from "stripe";

import { markOrderPaid } from "./order.js";

export interface StripeClient {
  paymentIntents: {
    create(params: Stripe.PaymentIntentCreateParams): Promise<Stripe.PaymentIntent>;
    retrieve(id: string): Promise<Stripe.PaymentIntent>;
  };
  webhooks: {
    constructEventAsync(payload: string, signature: string, secret: string): Promise<Stripe.Event>;
  };
}

/**
 * `stripe` balíček má explicitní `workerd` export podmínku (viz
 * package.json) - v Workers běhu se sám inicializuje na fetch/Web Crypto,
 * není potřeba ručně nastavovat httpClient. `createSubtleCryptoProvider()`
 * (Web Crypto, ne Node crypto) je nutný pro `constructEventAsync` - Workers
 * nemá Node crypto synchronní HMAC.
 */
export function createStripeClient(secretKey: string): StripeClient {
  const stripe = new Stripe(secretKey, { apiVersion: "2026-06-24.dahlia" });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  return {
    paymentIntents: {
      create: (params) => stripe.paymentIntents.create(params),
      retrieve: (id) => stripe.paymentIntents.retrieve(id),
    },
    webhooks: {
      constructEventAsync: (payload, signature, secret) =>
        stripe.webhooks.constructEventAsync(payload, signature, secret, undefined, cryptoProvider),
    },
  };
}

/** Založí PaymentIntent, nebo znovupoužije nedokončený z minulého pokusu. */
export async function paymentIntentFor(
  stripe: StripeClient,
  db: D1Database,
  order: any,
  currency: string,
): Promise<Stripe.PaymentIntent> {
  if (order.payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(order.payment_intent_id);
    if (existing.status !== "succeeded" && existing.status !== "canceled") return existing;
  }

  const intent = await stripe.paymentIntents.create({
    amount: order.total_cents,
    currency,
    metadata: { order_id: order.id },
    // Zatím jen karta - bez Stripe Elements ve frontendu (odloženo na
    // samostatný úkol) nemáme kam přesměrovat platby vyžadující redirect
    // (Klarna, bankovní přesměrování apod.).
    payment_method_types: ["card"],
  });

  // Známé okno (stejný princip jako u cancelOrder): dva rychlé souběžné
  // "Zaplatit" kliky by mohly každý vidět prázdné payment_intent_id a
  // vytvořit si vlastní PaymentIntent - zapíše se jen ten poslední, druhý
  // osiří (nevyužitý, časem vyexpiruje). Horší případ je zbytečný intent,
  // ne dvojí platba, proto vědomě neřešeno zámkem (stejně jako v
  // referenčním Django repu).
  await db
    .prepare(`UPDATE orders SET payment_intent_id = ?, updated_at = ? WHERE id = ?`)
    .bind(intent.id, new Date().toISOString(), order.id)
    .run();

  return intent;
}

/** Ověří podpis webhooku a při payment_intent.succeeded označí objednávku zaplacenou. */
export async function handleWebhookEvent(
  stripe: StripeClient,
  db: D1Database,
  rawBody: string,
  signature: string,
  secret: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch {
    return { status: 400, body: { detail: "Neplatný podpis webhooku." } };
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object as Stripe.PaymentIntent;
    const orderId = intent.metadata?.order_id;
    if (orderId) {
      // Přímý SELECT, ne accessibleOrder() - Stripe nemá ani uživatelský
      // token, ani guest_token; jeho "identita" je ověřený podpis výš.
      const order = await db.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first<any>();
      // Neznámá objednávka není chyba - Stripe jen chce 200, ať to nezkouší znovu.
      if (order) await markOrderPaid(db, order, "stripe", intent.id);
    }
  }

  return { status: 200, body: { received: true } };
}
