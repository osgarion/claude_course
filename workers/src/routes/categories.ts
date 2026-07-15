import { Hono } from "hono";

import { requireStaff } from "../auth/middleware.js";
import { slugify } from "../domain/slug.js";
import { serializeCategory } from "../serialize.js";
import type { AppEnv } from "../types.js";

const categories = new Hono<AppEnv>();

categories.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM categories ORDER BY name`).all();
  return c.json((results ?? []).map(serializeCategory));
});

categories.post("/", requireStaff, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return c.json({ name: ["Toto pole je povinné."] }, 400);

  const slug = String(body.slug ?? "").trim() || slugify(name);
  try {
    const category = await c.env.DB.prepare(
      `INSERT INTO categories (name, slug) VALUES (?, ?) RETURNING *`,
    )
      .bind(name, slug)
      .first();
    return c.json(serializeCategory(category), 201);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      return c.json({ slug: ["Kategorie s tímto slugem už existuje."] }, 400);
    }
    throw error;
  }
});

categories.get("/:id", async (c) => {
  const category = await c.env.DB.prepare(`SELECT * FROM categories WHERE id = ?`)
    .bind(c.req.param("id"))
    .first();
  if (!category) return c.json({ detail: "Kategorie nenalezena." }, 404);
  return c.json(serializeCategory(category));
});

categories.patch("/:id", requireStaff, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = c.req.param("id");

  const existing = await c.env.DB.prepare(`SELECT * FROM categories WHERE id = ?`).bind(id).first<any>();
  if (!existing) return c.json({ detail: "Kategorie nenalezena." }, 404);

  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  const slug = body.slug !== undefined ? String(body.slug).trim() : existing.slug;

  const updated = await c.env.DB.prepare(
    `UPDATE categories SET name = ?, slug = ? WHERE id = ? RETURNING *`,
  )
    .bind(name, slug, id)
    .first();
  return c.json(serializeCategory(updated));
});

categories.delete("/:id", requireStaff, async (c) => {
  const result = await c.env.DB.prepare(`DELETE FROM categories WHERE id = ?`)
    .bind(c.req.param("id"))
    .run();
  if (result.meta.changes === 0) return c.json({ detail: "Kategorie nenalezena." }, 404);
  return c.body(null, 204);
});

export default categories;
