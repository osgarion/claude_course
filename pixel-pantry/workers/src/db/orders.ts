/**
 * Přístup k objednávkám. JEDINÁ cesta, jak handler smí objednávku načíst,
 * je accessibleOrder() - vynuceno meta testem.
 *
 * BEZPEČNOSTNÍ JÁDRO (past, kterou tenhle soubor existuje aby uzavřel):
 *
 * Objednávka hosta má user_id NULL a anonymní request nemá uživatele.
 * Naivní kontrola vlastnictví `order.user_id === user?.id` je pak
 * `undefined === undefined` -> true, tedy KDOKOLI anonymní by se dostal
 * ke KAŽDÉ cizí objednávce hosta. (Django verze měla přesně tuhle past a
 * řeší ji explicitním is_authenticated checkem.)
 *
 * Proto jsou tady dvě zcela oddělené větve, které nikdy nesdílí porovnání:
 *   - přihlášený  -> rozhoduje POUZE vlastnictví, token je bezvýznamný
 *   - anonym      -> rozhoduje POUZE shoda guest_tokenu; bez tokenu rovnou null
 *
 * Vlastnictví je navíc vždy v klauzuli WHERE, ne až v podmínce v kódu -
 * neexistující a cizí záznam jsou pak od sebe nerozeznatelné a obojí vrací
 * 404 (403 by prozradilo, že objednávka s daným ID existuje).
 */
import type { Context } from "hono";
import type { AppEnv } from "../types.js";

export async function accessibleOrder(c: Context<AppEnv>, orderId: string): Promise<any | null> {
  const user = c.get("user");
  const db = c.env.DB;

  if (user) {
    return db
      .prepare(`SELECT * FROM orders WHERE id = ? AND user_id = ?`)
      .bind(orderId, user.id)
      .first();
  }

  const token = c.req.query("token") ?? c.req.header("X-Guest-Token");
  if (!token) return null; // <- bez tokenu anonym nikdy nic nedostane

  return db
    .prepare(
      `SELECT * FROM orders
        WHERE id = ?
          AND user_id IS NULL
          AND guest_token IS NOT NULL
          AND guest_token = ?`,
    )
    .bind(orderId, token)
    .first();
}

export async function orderItems(db: D1Database, orderId: string): Promise<any[]> {
  const { results } = await db
    .prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY id`)
    .bind(orderId)
    .all();
  return results ?? [];
}

export async function couponCodeFor(db: D1Database, couponId: number | null): Promise<string | null> {
  if (!couponId) return null;
  const row = await db.prepare(`SELECT code FROM coupons WHERE id = ?`).bind(couponId).first<{ code: string }>();
  return row?.code ?? null;
}
