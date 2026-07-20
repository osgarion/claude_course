import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { authRequired, rateLimitAuth } from "../auth/middleware.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { generateToken, hashToken } from "../auth/token.ts";
import type { AppEnv } from "../types.ts";

const auth = new Hono<AppEnv>();

const credentials = z.object({
  username: z.string().trim().min(3).max(40),
  password: z.string().min(8).max(200),
});

// Issue a fresh token for a user id and return the raw token (shown once).
async function issueToken(db: D1Database, userId: number): Promise<string> {
  const raw = generateToken();
  await db
    .prepare("INSERT INTO auth_tokens (user_id, key_hash) VALUES (?, ?)")
    .bind(userId, await hashToken(raw))
    .run();
  return raw;
}

/** POST /api/auth/register — create account, return a login token. */
auth.post("/register", rateLimitAuth, async (c) => {
  const parsed = credentials.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: "Username (3–40) and password (8+) required." });
  }
  const { username, password } = parsed.data;

  const iterations = Number(c.env.PBKDF2_ITERATIONS) || 100000;
  const hash = await hashPassword(password, iterations);

  let userId: number;
  try {
    const res = await c.env.DB.prepare("INSERT INTO users (username, password) VALUES (?, ?)")
      .bind(username, hash)
      .run();
    userId = res.meta.last_row_id as number;
  } catch (e) {
    // UNIQUE index on username (NOCASE) -> already taken.
    if (String(e).includes("UNIQUE")) {
      throw new HTTPException(409, { message: "Username already taken." });
    }
    throw e;
  }

  const token = await issueToken(c.env.DB, userId);
  return c.json({ token, user: { id: userId, username } }, 201);
});

/** POST /api/auth/login — verify credentials, return a fresh token. */
auth.post("/login", rateLimitAuth, async (c) => {
  const parsed = credentials.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new HTTPException(400, { message: "Username and password required." });
  }
  const { username, password } = parsed.data;

  const row = await c.env.DB.prepare(
    "SELECT id, username, password FROM users WHERE username = ? COLLATE NOCASE",
  )
    .bind(username)
    .first<{ id: number; username: string; password: string }>();

  // Verify even when the user is missing? We can't (no hash), but the generic
  // message below avoids leaking which usernames exist.
  const ok = row ? await verifyPassword(password, row.password) : false;
  if (!row || !ok) {
    throw new HTTPException(401, { message: "Invalid username or password." });
  }

  const token = await issueToken(c.env.DB, row.id);
  return c.json({ token, user: { id: row.id, username: row.username } });
});

/** GET /api/auth/me — who am I (requires token). */
auth.get("/me", authRequired, (c) => c.json({ user: c.get("user") }));

/** POST /api/auth/logout — revoke the presented token. */
auth.post("/logout", authRequired, async (c) => {
  const raw = c.req.header("Authorization")?.replace(/^Token\s+/i, "") ?? "";
  await c.env.DB.prepare("DELETE FROM auth_tokens WHERE key_hash = ?")
    .bind(await hashToken(raw))
    .run();
  return c.json({ ok: true });
});

export default auth;
