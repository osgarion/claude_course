import { Hono } from "hono";

import { authRequired, requireStaff } from "../auth/middleware.js";
import { parseCents } from "../domain/money.js";
import { slugify } from "../domain/slug.js";
import {
  serializeCategory,
  serializeImage,
  serializeProduct,
  serializeReview,
  serializeVariant,
} from "../serialize.js";
import type { AppEnv } from "../types.js";

const products = new Hono<AppEnv>();

// Hodnocení se počítá JEN ze schválených recenzí (is_approved = 1).
// AVG nad prázdnou množinou vrací NULL, což serializer převede na null
// ("zatím bez hodnocení") - to je jiná informace než 0 hvězdiček.
const RATING_AGG = `
  LEFT JOIN reviews r ON r.product_id = p.id AND r.is_approved = 1
`;

products.get("/", async (c) => {
  // Volitelný filtr ?category=<slug>. Bez něj se dotaz chová jako dřív, takže
  // stávající frontend nemusí nic měnit.
  const category = c.req.query("category")?.trim();

  // ?all=1 funguje jen pro provozovatele - jinak se tiše ignoruje (stejný
  // vzor jako onlyApproved u recenzí níž). Staff tak v adminu vidí i
  // neaktivní produkty, veřejný katalog zůstává jen aktivní.
  const user = c.get("user");
  const includeInactive = Boolean(user?.is_staff) && c.req.query("all") === "1";

  const statement = c.env.DB.prepare(
    `SELECT p.*, AVG(r.rating) AS avg_rating, COUNT(r.id) AS review_count
       FROM products p ${RATING_AGG}
       ${category ? "JOIN categories cat ON cat.id = p.category_id" : ""}
      WHERE ${includeInactive ? "1=1" : "p.is_active = 1"} ${category ? "AND cat.slug = ?" : ""}
      GROUP BY p.id
      ORDER BY p.created_at DESC`,
  );

  const { results } = await (category ? statement.bind(category) : statement).all();

  return c.json((results ?? []).map(serializeProduct));
});

/** Založení produktu - jen provozovatel obchodu. */
products.post("/", requireStaff, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return c.json({ name: ["Toto pole je povinné."] }, 400);

  let priceCents: number;
  try {
    priceCents = parseCents(body.price ?? "0");
  } catch {
    return c.json({ price: ["Neplatná cena."] }, 400);
  }

  const slug = String(body.slug ?? "").trim() || slugify(name);
  const now = new Date().toISOString();

  try {
    const product = await c.env.DB.prepare(
      `INSERT INTO products (name, slug, category_id, price_cents, description, image_url, stock, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
      .bind(
        name,
        slug,
        body.category ?? null,
        priceCents,
        String(body.description ?? ""),
        String(body.image_url ?? ""),
        Number(body.stock ?? 0),
        body.is_active === false ? 0 : 1,
        now,
        now,
      )
      .first<any>();
    return c.json(serializeProduct(product), 201);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      return c.json({ slug: ["Produkt s tímto slugem už existuje."] }, 400);
    }
    if (String(error).includes("CHECK constraint failed")) {
      return c.json({ detail: "Cena ani sklad nesmí být záporné." }, 400);
    }
    throw error;
  }
});

/** Úprava produktu - jen provozovatel obchodu. Adresováno číselným id, ne slugem. */
products.patch("/:id", requireStaff, async (c) => {
  const id = Number(c.req.param("id"));
  const existing = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first<any>();
  if (!existing) return c.json({ detail: "Produkt nenalezen." }, 404);

  const body = await c.req.json().catch(() => ({}));
  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  const slug = body.slug !== undefined ? String(body.slug).trim() : existing.slug;

  let priceCents = existing.price_cents;
  if (body.price !== undefined) {
    try {
      priceCents = parseCents(body.price);
    } catch {
      return c.json({ price: ["Neplatná cena."] }, 400);
    }
  }

  const categoryId = body.category !== undefined ? body.category : existing.category_id;
  const description = body.description !== undefined ? String(body.description) : existing.description;
  const imageUrl = body.image_url !== undefined ? String(body.image_url) : existing.image_url;
  const stock = body.stock !== undefined ? Number(body.stock) : existing.stock;
  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;

  try {
    const updated = await c.env.DB.prepare(
      `UPDATE products SET name = ?, slug = ?, category_id = ?, price_cents = ?, description = ?,
                            image_url = ?, stock = ?, is_active = ?, updated_at = ?
       WHERE id = ? RETURNING *`,
    )
      .bind(name, slug, categoryId, priceCents, description, imageUrl, stock, isActive, new Date().toISOString(), id)
      .first<any>();
    return c.json(serializeProduct(updated));
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      return c.json({ slug: ["Produkt s tímto slugem už existuje."] }, 400);
    }
    if (String(error).includes("CHECK constraint failed")) {
      return c.json({ detail: "Cena ani sklad nesmí být záporné." }, 400);
    }
    throw error;
  }
});

/** Smazání produktu - jen provozovatel obchodu. */
products.delete("/:id", requireStaff, async (c) => {
  const result = await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`)
    .bind(Number(c.req.param("id")))
    .run();
  if (result.meta.changes === 0) return c.json({ detail: "Produkt nenalezen." }, 404);
  return c.body(null, 204);
});

// --- Obrázky produktu (jen provozovatel) ---
// URL-based: ukládáme odkaz (image_url), ne nahraný soubor. Nahrávání do R2
// je vědomě odložené (Etapa 2) - referenční repo ho taky reálně nepoužívá.

/**
 * Výpis obrázků produktu pro admin. Veřejný katalog čte obrázky z detailu
 * produktu (GET /:slug), ten je ale gated na is_active=1 - admin potřebuje
 * vidět obrázky i u neaktivních produktů, proto samostatný staff endpoint.
 */
products.get("/:id/images", requireStaff, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM product_images WHERE product_id = ? ORDER BY id`,
  )
    .bind(Number(c.req.param("id")))
    .all();
  return c.json((results ?? []).map(serializeImage));
});

/** Přidání obrázku k produktu. {image_url, alt_text?, is_primary?} */
products.post("/:id/images", requireStaff, async (c) => {
  const productId = Number(c.req.param("id"));
  const exists = await c.env.DB.prepare(`SELECT id FROM products WHERE id = ?`).bind(productId).first();
  if (!exists) return c.json({ detail: "Produkt nenalezen." }, 404);

  const body = await c.req.json().catch(() => ({}));
  const imageUrl = String(body.image_url ?? "").trim();
  if (!imageUrl) return c.json({ image_url: ["Toto pole je povinné."] }, 400);

  const altText = String(body.alt_text ?? "");
  const isPrimary = body.is_primary === true;

  const insert = c.env.DB.prepare(
    `INSERT INTO product_images (product_id, image_url, alt_text, is_primary)
     VALUES (?, ?, ?, ?) RETURNING *`,
  ).bind(productId, imageUrl, altText, isPrimary ? 1 : 0);

  // Jeden primární obrázek na produkt: nastavení nového primárního shodí
  // ostatní. db.batch() je atomické - buď se povede obojí, nebo nic.
  let row: any;
  if (isPrimary) {
    const [, inserted] = await c.env.DB.batch<any>([
      c.env.DB.prepare(`UPDATE product_images SET is_primary = 0 WHERE product_id = ?`).bind(productId),
      insert,
    ]);
    row = inserted.results[0];
  } else {
    row = await insert.first<any>();
  }
  return c.json(serializeImage(row), 201);
});

/** Smazání obrázku produktu. Cizí kombinace id/produktu -> 404 (nepotvrzuj existenci). */
products.delete("/:id/images/:imageId", requireStaff, async (c) => {
  const result = await c.env.DB.prepare(`DELETE FROM product_images WHERE id = ? AND product_id = ?`)
    .bind(Number(c.req.param("imageId")), Number(c.req.param("id")))
    .run();
  if (result.meta.changes === 0) return c.json({ detail: "Obrázek nenalezen." }, 404);
  return c.body(null, 204);
});

products.get("/:slug", async (c) => {
  const db = c.env.DB;
  const product = await db
    .prepare(
      `SELECT p.*, AVG(r.rating) AS avg_rating, COUNT(r.id) AS review_count
         FROM products p ${RATING_AGG}
        WHERE p.slug = ? AND p.is_active = 1
        GROUP BY p.id`,
    )
    .bind(c.req.param("slug"))
    .first<any>();

  if (!product) return c.json({ detail: "Produkt nenalezen." }, 404);

  const [images, variants, reviews, category] = await Promise.all([
    db.prepare(`SELECT * FROM product_images WHERE product_id = ? ORDER BY id`).bind(product.id).all(),
    db.prepare(`SELECT * FROM product_variants WHERE product_id = ? ORDER BY id`).bind(product.id).all(),
    db
      .prepare(
        `SELECT rev.*, u.email AS user_email
           FROM reviews rev JOIN users u ON u.id = rev.user_id
          WHERE rev.product_id = ? AND rev.is_approved = 1
          ORDER BY rev.created_at DESC`,
      )
      .bind(product.id)
      .all(),
    product.category_id
      ? db.prepare(`SELECT * FROM categories WHERE id = ?`).bind(product.category_id).first()
      : Promise.resolve(null),
  ]);

  return c.json({
    ...serializeProduct(product),
    category: category ? serializeCategory(category) : null,
    images: (images.results ?? []).map(serializeImage),
    variants: (variants.results ?? []).map((v: any) => serializeVariant(v, product.price_cents)),
    reviews: (reviews.results ?? []).map(serializeReview),
  });
});

// --- Recenze produktu ---

products.get("/:productId/reviews", async (c) => {
  const user = c.get("user");
  const productId = Number(c.req.param("productId"));

  // Neschválené recenze vidí jen provozovatel obchodu.
  const onlyApproved = !(user && user.is_staff);
  const { results } = await c.env.DB.prepare(
    `SELECT rev.*, u.email AS user_email
       FROM reviews rev JOIN users u ON u.id = rev.user_id
      WHERE rev.product_id = ? ${onlyApproved ? "AND rev.is_approved = 1" : ""}
      ORDER BY rev.created_at DESC`,
  )
    .bind(productId)
    .all();

  return c.json((results ?? []).map(serializeReview));
});

products.post("/:productId/reviews", authRequired, async (c) => {
  const user = c.get("user")!;
  const productId = Number(c.req.param("productId"));
  const body = await c.req.json().catch(() => ({}));

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return c.json({ rating: ["Hodnocení musí být 1 až 5."] }, 400);
  }

  try {
    const review = await c.env.DB.prepare(
      `INSERT INTO reviews (product_id, user_id, rating, comment, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
      .bind(productId, user.id, rating, String(body.comment ?? ""), new Date().toISOString())
      .first<any>();

    return c.json(serializeReview({ ...review, user_email: user.email }), 201);
  } catch (error) {
    // Duplicitu hlídá UNIQUE(product_id, user_id) v databázi - na rozdíl od
    // předběžné kontroly v kódu je to odolné proti souběhu.
    if (String(error).includes("UNIQUE constraint failed")) {
      return c.json({ detail: "Tento produkt už jsi recenzoval/a." }, 400);
    }
    throw error;
  }
});

export default products;
