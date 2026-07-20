/**
 * Parity gate: the TypeScript model must reproduce every synthetic test case
 * within 1e-10 — the same bar the R and JS implementations pass. If this fails,
 * the TS port has drifted from the frozen bundle.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { predict, PREDICTORS, type Predictor } from "../src/model.ts";

// vitest runs from the workers/ root (where vitest.config.ts lives).
const csvPath = "public/d2t_teaching_augmented_firth_v1_test_cases.csv";

interface Case {
  case_id: string;
  inputs: Partial<Record<Predictor, number | null>>;
  expected: number;
}

function loadCases(): Case[] {
  const text = readFileSync(csvPath, "utf8").trim();
  const [header, ...lines] = text.split(/\r?\n/);
  const cols = header.split(",").map((c) => c.replace(/^"|"$/g, ""));
  return lines.map((line) => {
    const cells = line.split(",").map((c) => c.replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    cols.forEach((c, i) => (row[c] = cells[i]));
    const inputs: Partial<Record<Predictor, number | null>> = {};
    for (const p of PREDICTORS) inputs[p] = row[p] === "" ? null : Number(row[p]);
    return { case_id: row.case_id, inputs, expected: Number(row[".pred_d2t"]) };
  });
}

describe("D2T model — parity with .pred_d2t", () => {
  const cases = loadCases();

  it("has the expected synthetic cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(4);
  });

  for (const c of cases) {
    it(`${c.case_id} matches within 1e-10`, () => {
      const { p_d2t } = predict(c.inputs);
      expect(Math.abs(p_d2t - c.expected)).toBeLessThanOrEqual(1e-10);
    });
  }

  it("clamps negative treatment duration to zero", () => {
    const neg = predict({ DAS28_FW_fup: 3.2, CRP_fup: 10, duration_trt_ombi: -5, orm1: 2e5, fstl1: 1e4 });
    const zero = predict({ DAS28_FW_fup: 3.2, CRP_fup: 10, duration_trt_ombi: 0, orm1: 2e5, fstl1: 1e4 });
    expect(neg.p_d2t).toBeCloseTo(zero.p_d2t, 12);
  });
});
