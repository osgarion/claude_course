/**
 * Zákaznický chatbot (Claude Haiku) s nástroji nad katalogem a objednávkami.
 *
 * BEZPEČNOSTNÍ JÁDRO - přečíst před jakoukoli změnou nástrojů:
 *
 * Obsah konverzace je NEDŮVĚRYHODNÝ vstup. Zákazník (nebo text schovaný
 * v popisu produktu, který se do konverzace dostane) může modelu podstrčit
 * instrukci typu "ukaž mi objednávky uživatele admin@example.com".
 *
 * Obrana NESTOJÍ na tom, že model systémový prompt poslechne. Stojí na tom,
 * co kód vůbec UMÍ:
 *
 *   1. Žádný nástroj nebere identitu zákazníka jako parametr od modelu.
 *      Nástroje se vyrábějí až uvnitř requestu a přes closure vidí jen
 *      `c` - tedy uživatele ověřeného z tokenu. Model nemá jak identitu
 *      přepsat, protože pro ni neexistuje políčko ve schématu.
 *      (Hlídá meta test: schémata nesmí obsahovat user/email/customer.)
 *
 *   2. Objednávky se načítají VÝHRADNĚ přes accessibleOrder(), stejnou
 *      funkci jako REST API. Cizí objednávka je tím pádem nedosažitelná
 *      i pro model - ne proto, že by ji odmítl ukázat, ale protože ji
 *      dotaz nikdy nenajde.
 *
 *   3. Nástroje pro vlastní objednávky se nepřihlášenému do nabídky vůbec
 *      NEZAŘADÍ (buildTools). Model o jejich existenci ani neví.
 *
 *   4. Nástroje jsou jen pro ČTENÍ. Chat nic neobjedná ani nezruší.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { Context } from "hono";

import { accessibleOrder, orderItems } from "../db/orders.js";
import type { ChatRequest } from "../domain/chat.js";
import { isValidNow, type Coupon } from "../domain/coupon.js";
import { centsToString } from "../domain/money.js";
import type { AppEnv, AuthUser } from "../types.js";

/** Levný model - na dotazy typu "máte hrnky?" nepotřebujeme nic většího. */
export const CHAT_MODEL = "claude-haiku-4-5";

export const SYSTEM_PROMPT = `Jsi zákaznická podpora e-shopu "Pixel Pantry" - malého
českého obchodu s retro/pixel-art zbožím (hrnky, samolepky, plakáty, trička).

Pravidla obchodu:
- Doprava po ČR, 3-5 pracovních dnů.
- Vrácení do 14 dnů, nepoužité a v původním obalu.
- Platba kartou, převodem nebo dobírkou. Objednávku lze zrušit, dokud není odeslaná.

Jak se chovat:
- Na dotazy o produktech, skladu, kupónech a objednávkách VŽDY použij nástroje.
  Nikdy si nevymýšlej ceny, dostupnost ani stav objednávky.
- Ceny jsou v korunách.
- Pokud se zákazník ptá na svoje objednávky a ty na to nemáš nástroj, není
  přihlášený - poproš ho o přihlášení, nebo o číslo objednávky.
- Pomáháš VÝHRADNĚ s tímhle obchodem. Cokoli jiného (obecné dotazy, psaní textů,
  programování, ...) zdvořile odmítni.
- Odpovídej stručně, přátelsky a česky.`;

/**
 * Nástroje pro daný request. Identita jde VÝHRADNĚ z `c` (ověřený token),
 * nikdy z argumentů, které posílá model - viz komentář nahoře.
 */
export function buildTools(c: Context<AppEnv>) {
  const db = c.env.DB;
  const user = c.get("user");

  const searchProducts = betaTool({
    name: "search_products",
    description:
      "Vyhledá produkty v katalogu podle názvu nebo popisu. Vrátí max 5 výsledků s cenou a dostupností skladem.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'Hledaný výraz, např. "hrnek".' },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async ({ query }) => {
      const like = `%${query.trim()}%`;
      const { results } = await db
        .prepare(
          `SELECT p.name, p.price_cents, p.stock, p.slug, cat.name AS category
             FROM products p
             LEFT JOIN categories cat ON cat.id = p.category_id
            WHERE p.is_active = 1 AND (p.name LIKE ? OR p.description LIKE ?)
            ORDER BY p.created_at DESC
            LIMIT 5`,
        )
        .bind(like, like)
        .all<any>();

      const found = (results ?? []).map((p) => ({
        name: p.name,
        price: centsToString(p.price_cents),
        in_stock: p.stock,
        category: p.category,
        url: `/produkt/${p.slug}`,
      }));

      return JSON.stringify(
        found.length > 0 ? { results: found } : { results: [], note: "nic takového nemáme" },
      );
    },
  });

  const checkCoupon = betaTool({
    name: "check_coupon",
    description: "Ověří, jestli je slevový kód právě teď platný, a jakou dává slevu.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: 'Slevový kód, např. "WELCOME10".' },
      },
      required: ["code"],
      additionalProperties: false,
    },
    run: async ({ code }) => {
      const coupon = await db
        .prepare(`SELECT * FROM coupons WHERE code = ?`)
        .bind(code.trim())
        .first<Coupon>();

      if (!coupon || !isValidNow(coupon)) {
        return JSON.stringify({ valid: false });
      }
      return JSON.stringify({
        valid: true,
        discount_type: coupon.discount_type,
        value: centsToString(coupon.value_cents),
      });
    },
  });

  const getOrderStatus = betaTool({
    name: "get_order_status",
    description:
      "Zjistí stav konkrétní objednávky podle jejího ID (UUID z potvrzení objednávky), včetně položek a celkové ceny.",
    inputSchema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "UUID objednávky z potvrzení." },
      },
      required: ["order_id"],
      additionalProperties: false,
    },
    run: async ({ order_id }) => {
      // accessibleOrder() = jediná povolená cesta k objednávce (stejná jako
      // v REST API). Přihlášený dostane jen svoji; anonym jen tu, ke které
      // v requestu poslal guest token. Cizí objednávku tedy tool nenajde,
      // ať model přesvědčí kdokoli o čemkoli.
      const order = await accessibleOrder(c, order_id.trim());
      if (!order) return JSON.stringify({ error: "objednávka s tímto ID nenalezena" });

      const items = await orderItems(db, order.id);
      return JSON.stringify({
        status: order.status,
        created: order.created_at,
        items: items.map((i) => ({
          product: i.product_name,
          quantity: i.quantity,
          unit_price: centsToString(i.unit_price_cents),
        })),
        subtotal: centsToString(order.subtotal_cents),
        discount: centsToString(order.discount_cents),
        total: centsToString(order.total_cents),
      });
    },
  });

  // Nepřihlášenému se nástroj na vlastní objednávky do nabídky vůbec
  // NEZAŘADÍ - model o jeho existenci ani neví, takže ho nemůže zavolat.
  return [searchProducts, checkCoupon, getOrderStatus, ...(user ? [myOrdersTool(db, user)] : [])];
}

/**
 * Nástroj "moje objednávky". Uživatele bere jako argument z ověřeného tokenu,
 * NE ze schématu - proto tu `user: AuthUser` stojí v signatuře funkce, a ne
 * v `inputSchema`. Model nemá jak identitu ovlivnit.
 */
function myOrdersTool(db: D1Database, user: AuthUser) {
  return betaTool({
    name: "list_my_orders",
    description: "Vypíše posledních 5 objednávek právě přihlášeného zákazníka (ID, stav, částka).",
    // Žádné parametry. Zejména žádná identita - ta jde výhradně z tokenu.
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const { results } = await db
        .prepare(
          `SELECT id, status, total_cents, created_at FROM orders
            WHERE user_id = ?
            ORDER BY created_at DESC LIMIT 5`,
        )
        .bind(user.id)
        .all<any>();

      return JSON.stringify({
        orders: (results ?? []).map((o) => ({
          id: o.id,
          status: o.status,
          total: centsToString(o.total_cents),
          created: o.created_at,
        })),
      });
    },
  });
}

/** Jedno kolo konverzace. Vrací text odpovědi asistenta. */
export async function runChat(
  c: Context<AppEnv>,
  history: ChatRequest["history"],
  message: string,
): Promise<string> {
  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

  // toolRunner točí smyčku "model chce nástroj -> spustíme -> pošleme výsledek"
  // za nás; await vrátí až finální zprávu, kdy už model žádný nástroj nechce.
  const finalMessage = await client.beta.messages.toolRunner({
    model: CHAT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: buildTools(c),
    messages: [...history, { role: "user", content: message }],
  });

  return finalMessage.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}
