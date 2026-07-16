import { Hono } from "hono";
import { z } from "zod";

import { authRequired, rateLimitAuth } from "../auth/middleware.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { generateToken, hashToken, tokenFromHeader } from "../auth/token.js";
import { serializeUser } from "../serialize.js";
import type { AppEnv } from "../types.js";

const credentials = z.object({
  email: z.string().email("Zadej platný e-mail."),
  password: z.string().min(1),
});

// Minimální síla hesla - hrubý ekvivalent Django password validatorů
// (délka + ne úplně triviální heslo). Django jich má víc, tohle je zjednodušení.
const MIN_PASSWORD_LENGTH = 8;
const COMMON_PASSWORDS = new Set([
  "password", "12345678", "123456789", "qwertyui", "heslo123", "password1",
]);

const auth = new Hono<AppEnv>();

async function issueToken(db: D1Database, userId: number): Promise<string> {
  const raw = generateToken();
  await db
    .prepare(`INSERT INTO auth_tokens (key_hash, user_id, created_at) VALUES (?, ?, ?)`)
    .bind(await hashToken(raw), userId, new Date().toISOString())
    .run();
  return raw;
}

auth.post("/register", rateLimitAuth, async (c) => {
  const parsed = credentials.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ email: ["Zadej platný e-mail a heslo."] }, 400);
  }
  const { email, password } = parsed.data;

  if (password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ password: [`Heslo musí mít aspoň ${MIN_PASSWORD_LENGTH} znaků.`] }, 400);
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase()) || /^\d+$/.test(password)) {
    return c.json({ password: ["Heslo je příliš jednoduché."] }, 400);
  }

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) {
    return c.json({ email: ["Tento e-mail už je zaregistrovaný."] }, 400);
  }

  const iterations = Number(c.env.PBKDF2_ITERATIONS ?? "100000");
  const user = await c.env.DB.prepare(
    `INSERT INTO users (email, password, date_joined) VALUES (?, ?, ?)
     RETURNING id, email, first_name, last_name, is_staff`,
  )
    .bind(email, await hashPassword(password, iterations), new Date().toISOString())
    .first<any>();

  const token = await issueToken(c.env.DB, user.id);
  return c.json({ token, user: serializeUser(user) }, 201);
});

auth.post("/login", rateLimitAuth, async (c) => {
  const parsed = credentials.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ detail: "Nesprávný e-mail nebo heslo." }, 400);
  }
  const { email, password } = parsed.data;

  const user = await c.env.DB.prepare(
    `SELECT id, email, password, first_name, last_name, is_staff FROM users WHERE email = ? AND is_active = 1`,
  )
    .bind(email)
    .first<any>();

  // Stejná odpověď pro neexistující e-mail i špatné heslo - jinak by šlo
  // zjišťovat, které e-maily jsou v obchodě zaregistrované.
  if (!user || !(await verifyPassword(password, user.password))) {
    return c.json({ detail: "Nesprávný e-mail nebo heslo." }, 400);
  }

  const token = await issueToken(c.env.DB, user.id);
  return c.json({ token, user: serializeUser(user) });
});

auth.post("/logout", authRequired, async (c) => {
  // Maže se jen předložený token, ne všechny - přihlášení na jiném
  // zařízení zůstane platné.
  const raw = tokenFromHeader(c.req.header("Authorization"));
  if (raw) {
    await c.env.DB.prepare(`DELETE FROM auth_tokens WHERE key_hash = ?`)
      .bind(await hashToken(raw))
      .run();
  }
  return c.body(null, 204);
});

auth.get("/me", authRequired, (c) => c.json(serializeUser(c.get("user"))));

export default auth;
