import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { AppEnv, AuthUser } from "../types.js";
import { hashToken, tokenFromHeader } from "./token.js";

/**
 * Načte uživatele z tokenu, pokud nějaký přišel. Anonym NENÍ chyba -
 * guest checkout musí projít bez přihlášení, takže tohle nikdy neodmítá.
 */
export const authOptional: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);

  const raw = tokenFromHeader(c.req.header("Authorization"));
  if (raw) {
    const user = await c.env.DB.prepare(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_staff
         FROM auth_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.key_hash = ? AND u.is_active = 1`,
    )
      .bind(await hashToken(raw))
      .first<AuthUser>();

    if (user) c.set("user", user);
  }

  await next();
};

/** Vyžaduje přihlášení. Musí běžet až po authOptional. */
export const authRequired: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) {
    throw new HTTPException(401, { message: "Přihlášení je nutné." });
  }
  await next();
};

/**
 * Jen provozovatel obchodu (is_staff).
 *
 * 403 je tady správně a neporušuje pravidlo "cizí záznam vrací 404" -
 * kategorie je veřejný zdroj, takže "nesmíš zapisovat" nic neprozrazuje.
 * Pravidlo 404 platí pro CIZÍ záznamy (adresy, objednávky).
 */
export const requireStaff: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { message: "Přihlášení je nutné." });
  if (!user.is_staff) {
    throw new HTTPException(403, { message: "Jen provozovatel obchodu." });
  }
  await next();
};

/**
 * Brzda na brute-force login/registraci. Když binding chybí (testy,
 * `wrangler dev`), je to no-op - proto ten optional chaining.
 *
 * Pozor: limiter je per-colo a eventually consistent, takže je to zmírnění
 * zneužití, ne bezpečnostní hranice.
 */
export const rateLimitAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env.AUTH_LIMITER;
  if (limiter) {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await limiter.limit({ key: `auth:${ip}` });
    if (!success) {
      throw new HTTPException(429, { message: "Příliš mnoho pokusů, zkus to za chvíli." });
    }
  }
  await next();
};

/**
 * Brzda na chat. Tady nejde o brute-force, ale o PENÍZE - každé volání jde
 * na Anthropic API a stojí. Stejná omezení jako u rateLimitAuth (per-colo,
 * eventually consistent, no-op bez bindingu).
 */
export const rateLimitChat: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env.CHAT_LIMITER;
  if (limiter) {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await limiter.limit({ key: `chat:${ip}` });
    if (!success) {
      throw new HTTPException(429, { message: "Moc dotazů za sebou, dej mi chvilku." });
    }
  }
  await next();
};

export function currentUser(c: { get(key: "user"): AuthUser | null }): AuthUser | null {
  return c.get("user");
}
