import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { authOptional } from "./auth/middleware.js";
import addresses from "./routes/addresses.js";
import adminUsers from "./routes/adminUsers.js";
import auth from "./routes/auth.js";
import categories from "./routes/categories.js";
import chat from "./routes/chat.js";
import coupons from "./routes/coupons.js";
import orders from "./routes/orders.js";
import products from "./routes/products.js";
import reviews from "./routes/reviews.js";
import stripeWebhook from "./routes/stripeWebhook.js";
import { withSentry } from "./sentry.js";
import type { AppEnv } from "./types.js";

const app = new Hono<AppEnv>();

/**
 * DRF používá koncová lomítka (/api/products/), Hono ne. Aby fungovaly obě
 * varianty a nerozbily se existující URL, lomítko na konci /api/* cest
 * zahodíme ještě před routováním.
 */
app.use("/api/*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.length > 5 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
    return app.fetch(new Request(url, c.req.raw), c.env, c.executionCtx);
  }
  await next();
});

// Načte uživatele z tokenu, pokud přišel. Anonym není chyba (guest checkout),
// jednotlivé routy si přihlášení vynucují samy přes authRequired.
app.use("/api/*", authOptional);

app.route("/api/auth", auth);
app.route("/api/products", products);
app.route("/api/categories", categories);
app.route("/api/addresses", addresses);
app.route("/api/orders", orders);
app.route("/api/coupons", coupons);
app.route("/api/chat", chat);
app.route("/api/admin/users", adminUsers);
app.route("/api/stripe", stripeWebhook);
app.route("/api/reviews", reviews);

/**
 * Hezké URL detailu produktu. Statické assety neumí dynamické routy, takže
 * /produkt/<slug>/ obslouží Worker a vrátí product.html - slug si frontend
 * přečte z cesty. (Bez tohohle by musely být URL typu /product.html?slug=…)
 */
app.get("/produkt/*", (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/product.html";
  return c.env.ASSETS.fetch(new Request(url, { method: "GET" }));
});

/** Chybové odpovědi ve stejném tvaru jako DRF, ať frontend nemusí nic měnit. */
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ detail: error.message }, error.status);
  }
  // Neočekávaná (ne-HTTP) chyba: zaznamenej CELÝ popis - metoda, cesta, jméno,
  // zpráva a stack trace. Jde to do Workers Logs (observability.enabled ve
  // wrangler.jsonc, dohledatelné v dashboardu) i do Sentry, když je DSN
  // nastavené (prázdné = no-op, stejný fail-safe jako chatbot/Stripe). Sentry
  // navíc drží celý kontext requestu trvale a prohledávatelně.
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(
    `Neošetřená chyba: ${c.req.method} ${new URL(c.req.url).pathname}\n` +
      `${err.name}: ${err.message}\n${err.stack ?? "(stack není k dispozici)"}`,
  );
  if (c.env.SENTRY_DSN) Sentry.captureException(error);
  return c.json({ detail: "Něco se pokazilo." }, 500);
});

app.notFound((c) => c.json({ detail: "Nenalezeno." }, 404));

// withSentry obalí celý handler - zachytí i chyby mimo onError (např. při
// startu). Bez SENTRY_DSN je to no-op, takže výchozí chování se nemění.
export default withSentry(app);
