import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import type { AppEnv, AuthUser } from "../types.ts";
import { hashToken, tokenFromHeader } from "./token.ts";

/**
 * Loads the user from the token if one was sent. Anonymous is NOT an error —
 * /api/predict works without login. Individual routes enforce auth themselves
 * via authRequired.
 */
export const authOptional: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);

  const raw = tokenFromHeader(c.req.header("Authorization"));
  if (raw) {
    const user = await c.env.DB.prepare(
      `SELECT u.id, u.username
         FROM auth_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.key_hash = ?`,
    )
      .bind(await hashToken(raw))
      .first<AuthUser>();

    if (user) c.set("user", user);
  }

  await next();
};

/** Requires login. Must run after authOptional. */
export const authRequired: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user")) {
    throw new HTTPException(401, { message: "Login required." });
  }
  await next();
};

/**
 * Brute-force brake for login/registration. When the binding is missing (tests,
 * `wrangler dev`) this is a no-op — hence the truthiness check.
 *
 * Note: the limiter is per-colo and eventually consistent, so it mitigates
 * abuse rather than being a hard security boundary.
 */
export const rateLimitAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const limiter = c.env.AUTH_LIMITER;
  if (limiter) {
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    const { success } = await limiter.limit({ key: `auth:${ip}` });
    if (!success) {
      throw new HTTPException(429, { message: "Too many attempts, try again shortly." });
    }
  }
  await next();
};

export function currentUser(c: { get(key: "user"): AuthUser | null }): AuthUser | null {
  return c.get("user");
}
