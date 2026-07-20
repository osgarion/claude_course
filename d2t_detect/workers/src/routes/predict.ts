import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { predict, PREDICTORS, type Predictor } from "../model.ts";
import type { AppEnv } from "../types.ts";

const predictRoute = new Hono<AppEnv>();

// Each predictor is optional (omit/null -> median-imputed) and must be numeric.
const num = z.number().finite().nullish();
export const inputSchema = z.object({
  DAS28_FW_fup: num,
  CRP_fup: num,
  duration_trt_ombi: num,
  orm1: num,
  fstl1: num,
});

export function pickInputs(body: unknown): Partial<Record<Predictor, number | null>> {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, { message: "Inputs must be numbers (or omitted)." });
  }
  const out: Partial<Record<Predictor, number | null>> = {};
  for (const p of PREDICTORS) out[p] = (parsed.data[p] ?? null) as number | null;
  return out;
}

/** POST /api/predict — teaching D2T-class probability. No login required. */
predictRoute.post("/", async (c) => {
  const inputs = pickInputs(await c.req.json().catch(() => ({})));
  const r = predict(inputs);
  return c.json({
    p_d2t: r.p_d2t,
    p_rem: r.p_rem,
    percent_d2t: 100 * r.p_d2t,
    eta: r.eta,
    predicted_class: r.predicted_class,
    imputed: r.imputed,
    out_of_range: r.out_of_range,
    disclaimer:
      "Teaching-only cross-sectional class probability, not a prospective D2T risk and not for clinical decisions.",
  });
});

export default predictRoute;
