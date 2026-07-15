import { Hono } from "hono";

import { authRequired, requireStaff } from "../auth/middleware.js";
import { accessibleOrder, couponCodeFor, orderItems } from "../db/orders.js";
import { serializeOrder, serializePayment } from "../serialize.js";
import { OrderError, cancelOrder, createOrder, markOrderPaid, payOrder } from "../services/order.js";
import { createStripeClient, paymentIntentFor } from "../services/stripe.js";
import type { AppEnv } from "../types.js";

const orders = new Hono<AppEnv>();

async function respondWithOrder(c: any, order: any, status = 200) {
  const [items, couponCode] = await Promise.all([
    orderItems(c.env.DB, order.id),
    couponCodeFor(c.env.DB, order.coupon_id),
  ]);
  return c.json(serializeOrder(order, items, couponCode), status);
}

/** Vlastní objednávky - jen pro přihlášené. */
orders.get("/", authRequired, async (c) => {
  const user = c.get("user")!;
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`,
  )
    .bind(user.id)
    .all();

  const serialized = await Promise.all(
    (results ?? []).map(async (order: any) => {
      const [items, couponCode] = await Promise.all([
        orderItems(c.env.DB, order.id),
        couponCodeFor(c.env.DB, order.coupon_id),
      ]);
      return serializeOrder(order, items, couponCode);
    }),
  );
  return c.json(serialized);
});

/** Založení objednávky - i bez přihlášení (guest checkout). */
orders.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));

  if (!Array.isArray(body.items)) {
    return c.json({ items: ["Toto pole je povinné."] }, 400);
  }

  try {
    const orderId = await createOrder(c.env.DB, user, body);
    const order = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(orderId).first();
    return respondWithOrder(c, order, 201);
  } catch (error) {
    if (error instanceof OrderError) return c.json(error.body, error.status as any);
    throw error;
  }
});

/**
 * Admin výpis napříč všemi zákazníky - MUSÍ být zaregistrovaný před "/:id",
 * ať Hono nezkusí "admin" vzít jako ID objednávky.
 */
const ORDER_STATUSES = ["pending", "paid", "shipped", "cancelled"];

orders.get("/admin", requireStaff, async (c) => {
  // Volitelné filtry. Neznámý ?status se ignoruje (nefiltruje), ať překlep
  // nevrátí prázdno bez vysvětlení. ?search hledá přes e-mail zákazníka.
  const status = c.req.query("status");
  const search = c.req.query("search")?.trim();
  const conditions: string[] = [];
  const binds: any[] = [];
  if (status && ORDER_STATUSES.includes(status)) {
    conditions.push("o.status = ?");
    binds.push(status);
  }
  if (search) {
    conditions.push("u.email LIKE ?");
    binds.push(`%${search}%`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { results } = await c.env.DB.prepare(
    `SELECT o.*, u.email AS user_email FROM orders o LEFT JOIN users u ON u.id = o.user_id
       ${where} ORDER BY o.created_at DESC`,
  )
    .bind(...binds)
    .all();

  const serialized = await Promise.all(
    (results ?? []).map(async (order: any) => {
      const [items, couponCode] = await Promise.all([
        orderItems(c.env.DB, order.id),
        couponCodeFor(c.env.DB, order.coupon_id),
      ]);
      return { ...serializeOrder(order, items, couponCode), customer_email: order.user_email ?? "(host)" };
    }),
  );
  return c.json(serialized);
});

/**
 * Detail objednávky pro provozovatele. MUSÍ přes JOIN (SELECT o.* FROM
 * orders o ...), ne holý dotaz na samotnou tabulku orders podle id - to
 * hlídá meta počítadlo (tests/meta/rules.test.ts), které počet takových
 * dotazů stropuje.
 * Registrováno před "/:id", ať Hono "admin" nezkusí vzít jako ID.
 */
orders.get("/admin/:id", requireStaff, async (c) => {
  const order = await c.env.DB.prepare(
    `SELECT o.*, u.email AS user_email FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.id = ?`,
  )
    .bind(c.req.param("id"))
    .first<any>();
  if (!order) return c.json({ detail: "Objednávka nenalezena." }, 404);

  const [items, couponCode] = await Promise.all([
    orderItems(c.env.DB, order.id),
    couponCodeFor(c.env.DB, order.coupon_id),
  ]);
  return c.json({ ...serializeOrder(order, items, couponCode), customer_email: order.user_email ?? "(host)" });
});

/**
 * Hromadné odeslání. {ids: string[]} - každé id přes stejný podmíněný "claim"
 * UPDATE jako /:id/ship (jen paid -> shipped), celé v jednom db.batch().
 * Vrací počet reálně odeslaných (řádky, které nebyly 'paid', se přeskočí).
 */
orders.post("/admin/bulk-ship", requireStaff, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) return c.json({ shipped: 0 });

  const now = new Date().toISOString();
  const statements = ids.map((id: any) =>
    c.env.DB.prepare(
      `UPDATE orders SET status = 'shipped', updated_at = ? WHERE id = ? AND status = 'paid'`,
    ).bind(now, String(id)),
  );
  const results = await c.env.DB.batch(statements);
  const shipped = results.reduce((sum, r: any) => sum + (r.meta?.changes ?? 0), 0);
  return c.json({ shipped });
});

/**
 * Detail. accessibleOrder() je JEDINÁ cesta k načtení objednávky - řeší
 * i přístup hosta přes guest_token. Nedostupná objednávka vrací 404.
 */
orders.get("/:id", async (c) => {
  const order = await accessibleOrder(c, c.req.param("id"));
  if (!order) return c.json({ detail: "Objednávka nenalezena." }, 404);
  return respondWithOrder(c, order);
});

orders.post("/:id/pay", async (c) => {
  const order = await accessibleOrder(c, c.req.param("id"));
  if (!order) return c.json({ detail: "Objednávka nenalezena." }, 404);

  const body = await c.req.json().catch(() => ({}));
  const method = ["card", "bank_transfer", "cash_on_delivery"].includes(body.method)
    ? body.method
    : "card";

  try {
    // Bez klíče (etapa 1 default) beze změny - fake platba jako dřív.
    if (!c.env.STRIPE_SECRET_KEY) {
      const payment = await payOrder(c.env.DB, order, method);
      return c.json(serializePayment(payment));
    }

    if (order.status === "paid") {
      // Idempotentní jako fake cesta - dvojklik na "Zaplatit" po tom, co
      // webhook mezitím objednávku už označil zaplacenou, nesmí spadnout.
      const existing = await c.env.DB.prepare(`SELECT * FROM payments WHERE order_id = ?`)
        .bind(order.id)
        .first();
      return c.json(serializePayment(existing));
    }
    if (order.status !== "pending") {
      return c.json({ detail: `Objednávku ve stavu ${order.status} nelze zaplatit.` }, 400);
    }

    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
    const intent = await paymentIntentFor(stripe, c.env.DB, order, c.env.STRIPE_CURRENCY || "czk");
    return c.json({
      provider: "stripe",
      client_secret: intent.client_secret,
      publishable_key: c.env.STRIPE_PUBLISHABLE_KEY,
    });
  } catch (error) {
    if (error instanceof OrderError) return c.json(error.body, error.status as any);
    throw error;
  }
});

/**
 * Synchronní záloha k webhooku: ověří PaymentIntent přímo u Stripe a
 * potvrdí platbu, pokud webhook z nějakého důvodu ještě nedorazil (typicky
 * lokální vývoj bez veřejně dostupné URL pro webhook).
 */
orders.post("/:id/confirm_payment", async (c) => {
  const order = await accessibleOrder(c, c.req.param("id"));
  if (!order) return c.json({ detail: "Objednávka nenalezena." }, 404);

  if (order.status === "paid") {
    const existing = await c.env.DB.prepare(`SELECT * FROM payments WHERE order_id = ?`)
      .bind(order.id)
      .first();
    return c.json(serializePayment(existing));
  }
  if (order.status !== "pending" || !order.payment_intent_id) {
    return c.json({ detail: "Nelze potvrdit platbu pro tuto objednávku." }, 400);
  }

  try {
    const stripe = createStripeClient(c.env.STRIPE_SECRET_KEY);
    const intent = await stripe.paymentIntents.retrieve(order.payment_intent_id);
    if (intent.status !== "succeeded") {
      return c.json({ detail: `Platba není dokončená (stav: ${intent.status}).` }, 400);
    }

    const payment = await markOrderPaid(c.env.DB, order, "stripe", intent.id);
    return c.json(serializePayment(payment));
  } catch (error) {
    if (error instanceof OrderError) return c.json(error.body, error.status as any);
    throw error;
  }
});

/**
 * Odeslání objednávky - jen provozovatel obchodu. Podmíněný UPDATE ...
 * RETURNING * je zase "claim" vzor (jako u placení) - hlídaný přechod jen
 * paid -> shipped, žádná zvláštní SELECT WHERE id = ? navíc.
 */
orders.post("/:id/ship", requireStaff, async (c) => {
  const updated = await c.env.DB.prepare(
    `UPDATE orders SET status = 'shipped', updated_at = ? WHERE id = ? AND status = 'paid' RETURNING *`,
  )
    .bind(new Date().toISOString(), c.req.param("id"))
    .first<any>();

  if (!updated) return c.json({ detail: "Objednávku lze odeslat jen ze stavu 'paid'." }, 400);
  return respondWithOrder(c, updated);
});

orders.post("/:id/cancel", async (c) => {
  const order = await accessibleOrder(c, c.req.param("id"));
  if (!order) return c.json({ detail: "Objednávka nenalezena." }, 404);

  try {
    await cancelOrder(c.env.DB, order);
  } catch (error) {
    if (error instanceof OrderError) return c.json(error.body, error.status as any);
    throw error;
  }

  const fresh = await c.env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(order.id).first();
  return respondWithOrder(c, fresh);
});

export default orders;
