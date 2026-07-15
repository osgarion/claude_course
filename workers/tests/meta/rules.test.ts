/**
 * Pravidla o samotném kódu - hlídají, aby budoucí změny nerozbily
 * bezpečnostní návrh. Když někdo napíše nový handler, který si objednávku
 * načte "po svém", tyhle testy spadnou.
 *
 * Zdrojáky se načítají přes `?raw` (Vite je vloží jako text při buildu) -
 * uvnitř Workers runtime žádný filesystem není.
 */
import { describe, expect, it } from "vitest";

import schema from "../../migrations/0001_initial.sql?raw";
import assistantSource from "../../src/services/assistant.ts?raw";
import chatDomainSource from "../../src/domain/chat.ts?raw";
import couponSource from "../../src/domain/coupon.ts?raw";
import moneySource from "../../src/domain/money.ts?raw";
import variantSource from "../../src/domain/variant.ts?raw";
import dbOrdersSource from "../../src/db/orders.ts?raw";
import addressRoutes from "../../src/routes/addresses.ts?raw";
import orderRoutes from "../../src/routes/orders.ts?raw";
import orderService from "../../src/services/order.ts?raw";
import stripeService from "../../src/services/stripe.ts?raw";
import stripeWebhookRoute from "../../src/routes/stripeWebhook.ts?raw";
import productRoutes from "../../src/routes/products.ts?raw";
import couponRoutes from "../../src/routes/coupons.ts?raw";
import reviewRoutes from "../../src/routes/reviews.ts?raw";

describe("přístup k objednávkám", () => {
  it("routes/orders.ts načítá objednávku jen přes accessibleOrder()", () => {
    expect(orderRoutes).toContain("accessibleOrder");

    // Přímý dotaz na orders bez ownership predikátu by obešel guest_token
    // logiku i pravidlo "404 místo 403". Povolené jsou jen re-fetche UŽ
    // ověřené objednávky (po createOrder/cancelOrder).
    const directSelects = orderRoutes.match(/SELECT \* FROM orders WHERE id = \?(?! AND)/g) ?? [];
    expect(directSelects.length).toBeLessThanOrEqual(2);
  });

  it("db/orders.ts nikdy neurčuje přístup hosta jen podle user_id IS NULL", () => {
    // Anonymní větev MUSÍ porovnávat guest_token. Kdyby stačilo user_id IS NULL,
    // dostal by se kdokoli anonymní ke každé objednávce hosta.
    expect(dbOrdersSource).toContain("guest_token = ?");
    expect(dbOrdersSource).toMatch(/if \(!token\) return null/);
  });
});

describe("adresy", () => {
  it("každý dotaz na addresses nese vlastnictví v klauzuli WHERE", () => {
    const queries = addressRoutes.match(/(SELECT|UPDATE|DELETE)[\s\S]*?FROM addresses[\s\S]*?(?=`)/g) ?? [];

    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      // Bez `AND user_id = ?` by cizí adresa vracela 200 místo 404.
      expect(query).toMatch(/user_id = \?/);
    }
  });
});

describe("skladová bezpečnost", () => {
  it("schéma má CHECK (stock >= 0) na produktech i variantách", () => {
    // Bez tohohle constraintu není odečet skladu při souběhu bezpečný -
    // je to jediná věc, která drží atomicitu db.batch().
    const checks = schema.match(/stock\s+INTEGER NOT NULL DEFAULT 0 CHECK \(stock >= 0\)/g) ?? [];
    expect(checks).toHaveLength(2);
  });

  it("objednávka se zakládá jedním db.batch(), ne postupnými zápisy", () => {
    expect(orderService).toContain("db.batch(statements)");
  });

  it("odečet skladu je nepodmíněný (bezpečnost stojí na CHECK, ne na WHERE)", () => {
    // `WHERE stock >= ?` by NEfungovalo: UPDATE bez zásahu není chyba,
    // takže by batch commitnul objednávku bez odečtu skladu.
    expect(orderService).not.toMatch(/SET stock = stock - \?[\s\S]{0,40}stock >= /);
  });
});

describe("chatbot", () => {
  it("žádné schéma nástroje nebere identitu zákazníka jako parametr", () => {
    // Obrana proti prompt injection nestojí na tom, že model poslechne
    // systémový prompt, ale na tom, že pro identitu VŮBEC NEEXISTUJE políčko,
    // kterým by ji model mohl ovlivnit. Identita jde jen z ověřeného tokenu.
    //
    // Hledáme identitu jako klíč ve schématu (`user_id: {`), ne v SQL, kde
    // `WHERE user_id = ?` být MUSÍ.
    const schemaBlocks = assistantSource.match(/inputSchema:\s*\{[\s\S]*?\n    \},/g) ?? [];
    expect(schemaBlocks.length).toBeGreaterThan(0);

    for (const block of schemaBlocks) {
      expect(block).not.toMatch(/\b(user|user_id|email|customer)\s*:/);
    }
  });

  it("nástroje jsou jen pro čtení - chat nic nemění", () => {
    // Kdyby někdo chtěl přidat zápis (objednat/zrušit), musí to být vědomé
    // rozhodnutí, ne nedopatření. Django verze zápis má, tady zatím ne.
    const tools = assistantSource.slice(assistantSource.indexOf("export function buildTools"));
    expect(tools).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("objednávky se i v chatu načítají jen přes accessibleOrder()", () => {
    expect(assistantSource).toContain("accessibleOrder");
    expect(assistantSource).not.toMatch(/FROM orders WHERE id = \?(?! AND)/);
  });

  it("nástroj na vlastní objednávky se nepřihlášenému vůbec nenabídne", () => {
    expect(assistantSource).toMatch(/user \? \[myOrdersTool/);
  });
});

describe("platba (Stripe)", () => {
  it("webhook nikdy neoznačí objednávku zaplacenou bez ověření podpisu", () => {
    // Webhook je jediné místo v projektu, kde "identita" volajícího není
    // token ani guest_token, ale kryptografický podpis. Bez ověření by
    // kdokoli mohl poslat POST a zaplatit cizí objednávku zdarma.
    expect(stripeService).toContain("constructEventAsync");

    // Ověření musí textově předcházet použití eventu, ne přijít až po něm.
    const verifyAt = stripeService.indexOf("constructEventAsync(");
    const markPaidAt = stripeService.indexOf("markOrderPaid(db, order, \"stripe\"");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(markPaidAt).toBeGreaterThan(verifyAt);
  });

  it("webhook route nemá vlastní auth ani rate limit - hranicí důvěry je jen podpis", () => {
    expect(stripeWebhookRoute).not.toMatch(/authRequired|rateLimit/);
  });

  it("označení zaplaceno je vždy podmíněný claim (WHERE status = 'pending'), ne bezpodmínečný zápis", () => {
    // Stejný princip jako u skladu výš: druhé volání (webhook i confirm_payment
    // skoro současně) nesmí přepsat platbu, jen ji idempotentně vrátit.
    expect(orderService).toContain("WHERE id = ? AND status = 'pending'");
  });
});

describe("admin", () => {
  it("zapisovací endpointy nad produkty a kupóny jdou přes requireStaff", () => {
    // Základní "je to vůbec zapojené" kontrola - stejná úroveň rigoróznosti
    // jako ostatní pravidla v tomhle souboru (ne AST analýza, jen textová
    // kontrola, že middleware na daném souboru vůbec figuruje).
    expect(productRoutes).toContain("requireStaff");
    expect(couponRoutes).toContain("requireStaff");
    expect(reviewRoutes).toContain("requireStaff");
  });

  it("admin výpis objednávek i odeslání vyžadují requireStaff", () => {
    const adminAt = orderRoutes.indexOf(`orders.get("/admin"`);
    const shipAt = orderRoutes.indexOf(`orders.post("/:id/ship"`);
    expect(adminAt).toBeGreaterThan(-1);
    expect(shipAt).toBeGreaterThan(-1);
    expect(orderRoutes.slice(adminAt, adminAt + 60)).toContain("requireStaff");
    expect(orderRoutes.slice(shipAt, shipAt + 60)).toContain("requireStaff");
  });

  it("kupóny nejsou veřejně vypsatelné - i GET seznamu je jen pro provozovatele", () => {
    // Kupónové kódy jsou obchodní detail, ne veřejný katalog jako kategorie/
    // produkty - na rozdíl od nich má coupons.ts requireStaff i na GET "/".
    const listAt = couponRoutes.indexOf(`coupons.get("/", `);
    expect(listAt).toBeGreaterThan(-1);
    expect(couponRoutes.slice(listAt, listAt + 40)).toContain("requireStaff");
  });
});

describe("vrstvení", () => {
  it("doménová vrstva nesahá na databázi ani na Hono", () => {
    for (const source of [moneySource, couponSource, variantSource, chatDomainSource]) {
      expect(source).not.toContain("cloudflare:test");
      expect(source).not.toMatch(/from "hono"/);
      expect(source).not.toMatch(/D1Database/);
    }
  });
});
