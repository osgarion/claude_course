import { Hono } from "hono";

import { requireStaff } from "../auth/middleware.js";
import { isValidNow, type Coupon } from "../domain/coupon.js";
import { centsToString, parseCents } from "../domain/money.js";
import { serializeCoupon } from "../serialize.js";
import type { AppEnv } from "../types.js";

const coupons = new Hono<AppEnv>();

/** {code} -> detaily kupónu, nebo 404 (neplatný i expirovaný vypadají stejně). */
coupons.post("/validate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim();

  const coupon = await c.env.DB.prepare(`SELECT * FROM coupons WHERE code = ?`)
    .bind(code)
    .first<Coupon>();

  if (!coupon || !isValidNow(coupon)) {
    return c.json({ detail: "Neplatný nebo expirovaný kód." }, 404);
  }

  return c.json({
    code: coupon.code,
    discount_type: coupon.discount_type,
    // percent: 1000 -> "10.00" (%), fixed: 5000 -> "50.00" (Kč)
    value: centsToString(coupon.value_cents),
  });
});

// --- Správa kupónů - na rozdíl od kategorií/produktů je celý tenhle blok
// (i výpis) jen pro provozovatele. Kupónové kódy jsou obchodní detail, ne
// veřejný katalog - nechceme je nechat objevitelné přes API dřív, než je
// obchod oficiálně vyhlásí.

const DISCOUNT_TYPES = ["percent", "fixed"];

coupons.get("/", requireStaff, async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM coupons ORDER BY code`).all();
  return c.json((results ?? []).map(serializeCoupon));
});

coupons.get("/:id", requireStaff, async (c) => {
  const coupon = await c.env.DB.prepare(`SELECT * FROM coupons WHERE id = ?`)
    .bind(Number(c.req.param("id")))
    .first();
  if (!coupon) return c.json({ detail: "Kupón nenalezen." }, 404);
  return c.json(serializeCoupon(coupon));
});

coupons.post("/", requireStaff, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.code ?? "").trim();
  if (!code) return c.json({ code: ["Toto pole je povinné."] }, 400);

  const discountType = DISCOUNT_TYPES.includes(body.discount_type) ? body.discount_type : null;
  if (!discountType) return c.json({ discount_type: ["Musí být 'percent' nebo 'fixed'."] }, 400);

  let valueCents: number;
  try {
    valueCents = parseCents(body.value ?? "0");
  } catch {
    return c.json({ value: ["Neplatná hodnota."] }, 400);
  }

  try {
    const coupon = await c.env.DB.prepare(
      `INSERT INTO coupons (code, discount_type, value_cents, is_active, valid_from, valid_to)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
      .bind(
        code,
        discountType,
        valueCents,
        body.is_active === false ? 0 : 1,
        body.valid_from ?? null,
        body.valid_to ?? null,
      )
      .first<any>();
    return c.json(serializeCoupon(coupon), 201);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      return c.json({ code: ["Kupón s tímto kódem už existuje."] }, 400);
    }
    if (String(error).includes("CHECK constraint failed")) {
      return c.json({ detail: "Neplatný typ slevy nebo záporná hodnota." }, 400);
    }
    throw error;
  }
});

coupons.patch("/:id", requireStaff, async (c) => {
  const id = Number(c.req.param("id"));
  const existing = await c.env.DB.prepare(`SELECT * FROM coupons WHERE id = ?`).bind(id).first<any>();
  if (!existing) return c.json({ detail: "Kupón nenalezen." }, 404);

  const body = await c.req.json().catch(() => ({}));
  const code = body.code !== undefined ? String(body.code).trim() : existing.code;

  const discountType =
    body.discount_type !== undefined
      ? DISCOUNT_TYPES.includes(body.discount_type)
        ? body.discount_type
        : null
      : existing.discount_type;
  if (discountType === null) return c.json({ discount_type: ["Musí být 'percent' nebo 'fixed'."] }, 400);

  let valueCents = existing.value_cents;
  if (body.value !== undefined) {
    try {
      valueCents = parseCents(body.value);
    } catch {
      return c.json({ value: ["Neplatná hodnota."] }, 400);
    }
  }

  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;
  const validFrom = body.valid_from !== undefined ? body.valid_from : existing.valid_from;
  const validTo = body.valid_to !== undefined ? body.valid_to : existing.valid_to;

  try {
    const updated = await c.env.DB.prepare(
      `UPDATE coupons SET code = ?, discount_type = ?, value_cents = ?, is_active = ?, valid_from = ?, valid_to = ?
       WHERE id = ? RETURNING *`,
    )
      .bind(code, discountType, valueCents, isActive, validFrom, validTo, id)
      .first<any>();
    return c.json(serializeCoupon(updated));
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      return c.json({ code: ["Kupón s tímto kódem už existuje."] }, 400);
    }
    if (String(error).includes("CHECK constraint failed")) {
      return c.json({ detail: "Neplatný typ slevy nebo záporná hodnota." }, 400);
    }
    throw error;
  }
});

coupons.delete("/:id", requireStaff, async (c) => {
  const result = await c.env.DB.prepare(`DELETE FROM coupons WHERE id = ?`)
    .bind(Number(c.req.param("id")))
    .run();
  if (result.meta.changes === 0) return c.json({ detail: "Kupón nenalezen." }, 404);
  return c.body(null, 204);
});

export default coupons;
