import { env } from "cloudflare:test";

import { hashPassword } from "../src/auth/password.js";
import { generateToken, hashToken } from "../src/auth/token.js";
import { slugify } from "../src/domain/slug.js";
import type { AuthUser } from "../src/types.js";

export const TEST_PASSWORD = "sturdy-password-1";

// Nízký počet iterací jen pro testy - jinak by každý test platil plnou
// PBKDF2 cenu a suita by běžela desítky sekund.
const TEST_ITERATIONS = 1000;

/** Vyprázdní tabulky mezi testy (pořadí kvůli cizím klíčům). */
export async function resetDb(): Promise<void> {
  const tables = [
    "payments",
    "order_items",
    "orders",
    "reviews",
    "product_variants",
    "product_images",
    "products",
    "categories",
    "addresses",
    "auth_tokens",
    "coupons",
    "users",
  ];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

export async function makeUser(
  overrides: { email?: string; is_staff?: number } = {},
): Promise<AuthUser> {
  const email = overrides.email ?? "zakaznik@example.com";
  return (await env.DB.prepare(
    `INSERT INTO users (email, password, is_staff, date_joined)
     VALUES (?, ?, ?, ?) RETURNING id, email, first_name, last_name, is_staff`,
  )
    .bind(
      email,
      await hashPassword(TEST_PASSWORD, TEST_ITERATIONS),
      overrides.is_staff ?? 0,
      new Date().toISOString(),
    )
    .first<AuthUser>())!;
}

/** Vrátí holý token, kterým se dá volat API jako daný uživatel. */
export async function makeToken(userId: number): Promise<string> {
  const raw = generateToken();
  await env.DB.prepare(`INSERT INTO auth_tokens (key_hash, user_id, created_at) VALUES (?, ?, ?)`)
    .bind(await hashToken(raw), userId, new Date().toISOString())
    .run();
  return raw;
}

export async function makeAddress(userId: number | null): Promise<any> {
  return env.DB.prepare(
    `INSERT INTO addresses (user_id, full_name, street, city, postal_code, country)
     VALUES (?, 'Jan Novák', 'Ulice 1', 'Praha', '10000', 'Česko') RETURNING *`,
  )
    .bind(userId)
    .first();
}

export async function makeProduct(
  overrides: { name?: string; price_cents?: number; stock?: number } = {},
): Promise<any> {
  const name = overrides.name ?? "Produkt";
  const now = new Date().toISOString();
  return env.DB.prepare(
    `INSERT INTO products (name, slug, price_cents, stock, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      name,
      `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`,
      overrides.price_cents ?? 10000,
      overrides.stock ?? 5,
      now,
      now,
    )
    .first();
}

export async function makeCoupon(
  overrides: { code?: string; discount_type?: "percent" | "fixed"; value_cents?: number } = {},
): Promise<any> {
  return env.DB.prepare(
    `INSERT INTO coupons (code, discount_type, value_cents) VALUES (?, ?, ?) RETURNING *`,
  )
    .bind(
      overrides.code ?? "SLEVA10",
      overrides.discount_type ?? "percent",
      overrides.value_cents ?? 1000,
    )
    .first();
}
