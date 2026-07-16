/**
 * Adresy přihlášeného zákazníka.
 *
 * Vlastnictví je VŽDY v klauzuli WHERE (`AND user_id = ?`), nikdy až jako
 * podmínka v kódu nad načteným řádkem. Cizí a neexistující adresa jsou pak
 * nerozeznatelné a obě vrací 404 - 403 by prozradilo, že adresa s daným ID
 * existuje. Vynuceno meta testem.
 */
import { Hono } from "hono";

import { authRequired } from "../auth/middleware.js";
import { serializeAddress } from "../serialize.js";
import type { AppEnv } from "../types.js";

const addresses = new Hono<AppEnv>();
addresses.use("*", authRequired);

addresses.get("/", async (c) => {
  const user = c.get("user")!;
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM addresses WHERE user_id = ? ORDER BY id`,
  )
    .bind(user.id)
    .all();
  return c.json((results ?? []).map(serializeAddress));
});

addresses.post("/", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json().catch(() => ({}));

  const required = ["full_name", "street", "city", "postal_code", "country"];
  const missing = required.filter((field) => !String(body[field] ?? "").trim());
  if (missing.length > 0) {
    return c.json(Object.fromEntries(missing.map((f) => [f, ["Toto pole je povinné."]])), 400);
  }

  const address = await c.env.DB.prepare(
    `INSERT INTO addresses (user_id, full_name, street, city, postal_code, country, phone, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      user.id,
      body.full_name,
      body.street,
      body.city,
      body.postal_code,
      body.country,
      String(body.phone ?? ""),
      body.is_default ? 1 : 0,
    )
    .first();

  return c.json(serializeAddress(address), 201);
});

addresses.get("/:id", async (c) => {
  const user = c.get("user")!;
  const address = await c.env.DB.prepare(`SELECT * FROM addresses WHERE id = ? AND user_id = ?`)
    .bind(c.req.param("id"), user.id)
    .first();
  if (!address) return c.json({ detail: "Adresa nenalezena." }, 404);
  return c.json(serializeAddress(address));
});

addresses.patch("/:id", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json().catch(() => ({}));

  const existing = await c.env.DB.prepare(`SELECT * FROM addresses WHERE id = ? AND user_id = ?`)
    .bind(c.req.param("id"), user.id)
    .first<any>();
  if (!existing) return c.json({ detail: "Adresa nenalezena." }, 404);

  const merged = {
    full_name: body.full_name ?? existing.full_name,
    street: body.street ?? existing.street,
    city: body.city ?? existing.city,
    postal_code: body.postal_code ?? existing.postal_code,
    country: body.country ?? existing.country,
    phone: body.phone ?? existing.phone,
    is_default: body.is_default !== undefined ? (body.is_default ? 1 : 0) : existing.is_default,
  };

  const updated = await c.env.DB.prepare(
    `UPDATE addresses
        SET full_name = ?, street = ?, city = ?, postal_code = ?, country = ?, phone = ?, is_default = ?
      WHERE id = ? AND user_id = ? RETURNING *`,
  )
    .bind(
      merged.full_name,
      merged.street,
      merged.city,
      merged.postal_code,
      merged.country,
      merged.phone,
      merged.is_default,
      c.req.param("id"),
      user.id,
    )
    .first();

  return c.json(serializeAddress(updated));
});

addresses.delete("/:id", async (c) => {
  const user = c.get("user")!;
  try {
    const result = await c.env.DB.prepare(`DELETE FROM addresses WHERE id = ? AND user_id = ?`)
      .bind(c.req.param("id"), user.id)
      .run();
    if (result.meta.changes === 0) return c.json({ detail: "Adresa nenalezena." }, 404);
    return c.body(null, 204);
  } catch (error) {
    // FK RESTRICT: adresa je použitá na objednávce (Django PROTECT).
    // Django by tady spadlo na 500, my vrátíme čitelnou 409.
    if (String(error).includes("FOREIGN KEY constraint failed")) {
      return c.json({ detail: "Adresa je použitá na objednávce a nejde smazat." }, 409);
    }
    throw error;
  }
});

export default addresses;
