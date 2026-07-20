/**
 * D2T teaching model — TypeScript port of the same logistic math implemented in
 * R (r-backend/R/predict.R) and JS (public/app.js). The coefficients come from
 * the frozen bundle JSON (imported at build time), so this stays in lock-step
 * with the other two implementations. Verified against the test-case CSV in
 * tests/model.test.ts (agreement within 1e-10).
 */

import bundle from "../public/d2t_teaching_augmented_firth_v1.json";

export type Predictor = "DAS28_FW_fup" | "CRP_fup" | "duration_trt_ombi" | "orm1" | "fstl1";

export const PREDICTORS = bundle.predictors as Predictor[];

const COEF = bundle.coefficients.raw_scale as Record<Predictor, number>;
const INTERCEPT = bundle.coefficients.raw_scale_intercept;

const MEDIANS = Object.fromEntries(
  bundle.input_schema.map((s) => [s.name, s.imputation_median]),
) as Record<Predictor, number>;

const RANGES = Object.fromEntries(
  bundle.input_schema.map((s) => [s.name, { min: s.observed_min, max: s.observed_max }]),
) as Record<Predictor, { min: number; max: number }>;

export interface PredictResult {
  p_d2t: number;
  p_rem: number;
  eta: number;
  predicted_class: "d2t" | "rem";
  imputed: Predictor[];
  out_of_range: Predictor[];
}

/**
 * Predict from raw inputs. A null/undefined/NaN value is replaced by the
 * training median (and reported in `imputed`). Negative treatment duration is
 * clamped to 0 (per the known-data-issue note in the bundle/README).
 */
export function predict(inputs: Partial<Record<Predictor, number | null | undefined>>): PredictResult {
  let eta = INTERCEPT;
  const imputed: Predictor[] = [];
  const out_of_range: Predictor[] = [];

  for (const name of PREDICTORS) {
    let v = inputs[name];
    if (v === null || v === undefined || Number.isNaN(v)) {
      v = MEDIANS[name];
      imputed.push(name);
    } else {
      if (name === "duration_trt_ombi" && v < 0) v = 0;
      const r = RANGES[name];
      if (v < r.min || v > r.max) out_of_range.push(name);
    }
    eta += COEF[name] * v;
  }

  const p_d2t = 1 / (1 + Math.exp(-eta));
  return {
    p_d2t,
    p_rem: 1 - p_d2t,
    eta,
    predicted_class: p_d2t >= 0.5 ? "d2t" : "rem",
    imputed,
    out_of_range,
  };
}

export const MODEL_ID = bundle.model_id;
export const MODEL_VERSION = bundle.version;
