import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { authRequired } from "../auth/middleware.ts";
import { predict } from "../model.ts";
import type { AppEnv } from "../types.ts";
import { pickInputs } from "./predict.ts";

const assessments = new Hono<AppEnv>();

// Every route here requires login.
assessments.use("*", authRequired);

// Next sequential "PT-000N" label for this user (max existing + 1). Purely a
// suggestion — the client may send any label instead.
async function nextLabel(db: D1Database, userId: number): Promise<string> {
  const rows = await db
    .prepare("SELECT patient_label FROM assessments WHERE user_id = ?")
    .bind(userId)
    .all<{ patient_label: string }>();
  let max = 0;
  for (const r of rows.results ?? []) {
    const m = /^PT-(\d+)$/i.exec(r.patient_label);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `PT-${String(max + 1).padStart(4, "0")}`;
}

/** GET /api/assessments/next-id — the suggested next patient label. */
assessments.get("/next-id", async (c) => {
  const user = c.get("user")!;
  return c.json({ patient_label: await nextLabel(c.env.DB, user.id) });
});

/** GET /api/assessments — the caller's saved assessments, newest first. */
assessments.get("/", async (c) => {
  const user = c.get("user")!;
  const rows = await c.env.DB.prepare(
    `SELECT id, patient_label, inputs_json, p_d2t, p_rem, predicted_class, eta, note, created_at
       FROM assessments WHERE user_id = ? ORDER BY created_at DESC, id DESC`,
  )
    .bind(user.id)
    .all();
  const items = (rows.results ?? []).map((r) => ({
    ...r,
    inputs: JSON.parse(r.inputs_json as string),
  }));
  return c.json({ items });
});

const saveSchema = z.object({
  patient_label: z.string().trim().min(1).max(60).optional(),
  note: z.string().trim().max(1000).optional(),
  inputs: z.record(z.string(), z.number().finite().nullable()).optional(),
});

/**
 * POST /api/assessments — store an assessment for the logged-in user.
 * The probability is RECOMPUTED server-side from the submitted inputs, so the
 * stored value is authoritative and never trusted from the client. If no
 * patient_label is given, the next PT-000N is assigned.
 */
assessments.post("/", async (c) => {
  const user = c.get("user")!;
  const body = saveSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) throw new HTTPException(400, { message: "Invalid assessment payload." });

  const inputs = pickInputs(body.data.inputs ?? {});
  const r = predict(inputs);
  const label = body.data.patient_label?.trim() || (await nextLabel(c.env.DB, user.id));
  const note = body.data.note ?? "";

  try {
    const res = await c.env.DB.prepare(
      `INSERT INTO assessments
         (user_id, patient_label, inputs_json, p_d2t, p_rem, predicted_class, eta, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(user.id, label, JSON.stringify(inputs), r.p_d2t, r.p_rem, r.predicted_class, r.eta, note)
      .run();
    return c.json(
      {
        id: res.meta.last_row_id,
        patient_label: label,
        p_d2t: r.p_d2t,
        predicted_class: r.predicted_class,
      },
      201,
    );
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      throw new HTTPException(409, { message: `Label "${label}" already used — pick another.` });
    }
    throw e;
  }
});

/** DELETE /api/assessments/:id — remove one of the caller's assessments. */
assessments.delete("/:id", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: "Bad id." });

  const res = await c.env.DB.prepare("DELETE FROM assessments WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .run();
  // 404 for someone else's row too — don't reveal that it exists.
  if (!res.meta.changes) throw new HTTPException(404, { message: "Not found." });
  return c.json({ ok: true });
});

export default assessments;
