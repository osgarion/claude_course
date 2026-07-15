import { Hono } from "hono";

import { requireStaff } from "../auth/middleware.js";
import { serializeReview } from "../serialize.js";
import type { AppEnv } from "../types.js";

const reviews = new Hono<AppEnv>();

/**
 * Schválení/zamítnutí recenze - jen provozovatel obchodu. Prosté přepnutí
 * is_approved, žádný samostatný "approve" akční endpoint (stejně jako
 * referenční Django admin - list_editable checkbox, ne akce navíc).
 */
reviews.patch("/:id", requireStaff, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.is_approved !== "boolean") {
    return c.json({ is_approved: ["Toto pole je povinné (boolean)."] }, 400);
  }

  const updated = await c.env.DB.prepare(`UPDATE reviews SET is_approved = ? WHERE id = ? RETURNING *`)
    .bind(body.is_approved ? 1 : 0, c.req.param("id"))
    .first<any>();
  if (!updated) return c.json({ detail: "Recenze nenalezena." }, 404);

  const withEmail = await c.env.DB
    .prepare(`SELECT rev.*, u.email AS user_email FROM reviews rev JOIN users u ON u.id = rev.user_id WHERE rev.id = ?`)
    .bind(updated.id)
    .first<any>();
  return c.json(serializeReview(withEmail));
});

export default reviews;
