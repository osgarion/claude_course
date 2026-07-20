/* D2T teaching classifier — static implementation of d2t_teaching_augmented_firth_v1.
 *
 * The model JSON is the source of truth: we fetch it at runtime so a re-export of
 * the bundle updates the app with no code change. The embedded fallback below only
 * kicks in when fetch is blocked (e.g. opening index.html directly via file://).
 */

const MODEL_FILE = "d2t_teaching_augmented_firth_v1.json";
const TESTS_FILE = "d2t_teaching_augmented_firth_v1_test_cases.csv";
const REF_FILE = "variable_reference.json";

// Display-only clinical annotations (official names + reference ranges). Kept
// separate from the model bundle; embedded fallback for file:// use.
const EMBEDDED_REF = {
  variables: {
    DAS28_FW_fup: { official_label: "DAS28-ESR (Disease Activity Score, 28 joints)", reference: "Activity: remission <2.6 · low 2.6–3.2 · moderate >3.2–5.1 · high >5.1" },
    CRP_fup: { official_label: "C-reactive protein (CRP)", reference: "Normal <5 mg/L (typical adult reference; some labs use <10)" },
    duration_trt_ombi: { official_label: "Treatment duration", reference: "No clinical reference range — context-dependent (months, ≥0)" },
    orm1: { official_label: "Orosomucoid / α1-acid glycoprotein (ORM1)", reference: "Serum α1-acid glycoprotein normal ≈0.5–1.2 g/L (≈500,000–1,200,000 ng/mL); this assay's ng/mL scale may differ" },
    fstl1: { official_label: "Follistatin-like protein 1 (FSTL1)", reference: "No established clinical reference range (research biomarker)" },
  },
};

// Fallback copy of the bundle, used only if fetch() fails (file:// protocol).
const EMBEDDED_MODEL = {
  model_id: "d2t_teaching_augmented_firth_v1",
  version: "1.0.0",
  positive_class: "d2t",
  negative_class: "rem",
  predictors: ["DAS28_FW_fup", "CRP_fup", "duration_trt_ombi", "orm1", "fstl1"],
  input_schema: [
    { name: "DAS28_FW_fup", label: "DAS28-ESR", unit: "score", imputation_median: 2.2648459511504044, observed_min: 0.6952030263919616, observed_max: 8.782693651277647 },
    { name: "CRP_fup", label: "CRP", unit: "mg/L", imputation_median: 2.78, observed_min: 0.15, observed_max: 124.68 },
    { name: "duration_trt_ombi", label: "trt duration", unit: "months", imputation_median: 33.3305954825462, observed_min: -37.68377823408624, observed_max: 252.12320328542094 },
    { name: "orm1", label: "ORM1 (orosomucoid)", unit: "ng/mL", imputation_median: 160300, observed_min: 17200, observed_max: 986000 },
    { name: "fstl1", label: "FSTL1", unit: "ng/mL", imputation_median: 9526.666, observed_min: 385.183, observed_max: 49835.614 },
  ],
  coefficients: {
    raw_scale_intercept: -4.6973178899409103,
    raw_scale: {
      DAS28_FW_fup: 1.4649356956935342,
      CRP_fup: -0.00073402046179611,
      duration_trt_ombi: -0.012166338698613725,
      orm1: 3.684753037361066e-6,
      fstl1: -2.045586383357065e-5,
    },
  },
};

// Embedded synthetic test cases (mirror of the CSV) for the offline self-test.
const EMBEDDED_TESTS = [
  { case_id: "synthetic_low_activity", DAS28_FW_fup: 1.5, CRP_fup: 2, duration_trt_ombi: 24, orm1: 100000, fstl1: 5000, pred_d2t: 0.0739746918968876 },
  { case_id: "synthetic_midrange", DAS28_FW_fup: 3.2, CRP_fup: 10, duration_trt_ombi: 36, orm1: 200000, fstl1: 10000, pred_d2t: 0.519375270167972 },
  { case_id: "synthetic_high_activity", DAS28_FW_fup: 5.5, CRP_fup: 40, duration_trt_ombi: 60, orm1: 500000, fstl1: 20000, pred_d2t: 0.982600250036478 },
  { case_id: "synthetic_missing_fstl1", DAS28_FW_fup: 3.2, CRP_fup: 10, duration_trt_ombi: 36, orm1: 200000, fstl1: null, pred_d2t: 0.521791777110299 },
];

// ---- Core model math --------------------------------------------------------

// Predict from a map of {predictor: value|null}. Missing/null -> imputation_median.
// Returns { p_d2t, p_rem, eta, imputed, intercept, terms }, where each term is the
// predictor's additive contribution to the log-odds (coef * value) — used to explain
// the score. Positive term pushes toward D2T, negative toward remission.
function predict(model, raw) {
  const coef = model.coefficients.raw_scale;
  const medians = Object.fromEntries(model.input_schema.map((s) => [s.name, s.imputation_median]));
  const intercept = model.coefficients.raw_scale_intercept;
  let eta = intercept;
  const imputed = [];
  const terms = [];
  for (const name of model.predictors) {
    let v = raw[name];
    let wasImputed = false;
    if (v == null || Number.isNaN(v)) {
      v = medians[name];
      imputed.push(name);
      wasImputed = true;
    }
    const contribution = coef[name] * v;
    eta += contribution;
    terms.push({ name, value: v, coef: coef[name], contribution, imputed: wasImputed });
  }
  const p_d2t = 1 / (1 + Math.exp(-eta));
  return { p_d2t, p_rem: 1 - p_d2t, eta, imputed, intercept, terms };
}

// ---- Data loading -----------------------------------------------------------

async function loadJSON(url, fallback) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    return fallback;
  }
}

function parseTestCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const cols = lines[0].split(",").map((c) => c.replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.replace(/^"|"$/g, ""));
    const row = {};
    cols.forEach((c, i) => (row[c] = cells[i]));
    const num = (x) => (x === "" || x == null ? null : Number(x));
    return {
      case_id: row.case_id,
      DAS28_FW_fup: num(row.DAS28_FW_fup),
      CRP_fup: num(row.CRP_fup),
      duration_trt_ombi: num(row.duration_trt_ombi),
      orm1: num(row.orm1),
      fstl1: num(row.fstl1),
      pred_d2t: num(row[".pred_d2t"]),
    };
  });
}

async function loadTests() {
  try {
    const r = await fetch(TESTS_FILE, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    return parseTestCSV(await r.text());
  } catch {
    return EMBEDDED_TESTS;
  }
}

// ---- UI ---------------------------------------------------------------------

const TOL = 1e-10;
let MODEL = null;
let REF = EMBEDDED_REF; // display annotations; replaced by fetched file when served

function fmt(x, dp = 3) {
  return Number(x).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// Official display label for a predictor (annotation overrides the bundle label).
function labelFor(name, fallback) {
  return (REF.variables[name] && REF.variables[name].official_label) || fallback || name;
}

// Basic HTML-escape for annotation text injected into markup.
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function buildForm(model) {
  const wrap = document.getElementById("fields");
  wrap.innerHTML = "";
  for (const s of model.input_schema) {
    const id = "in_" + s.name;
    const nonNeg = s.name === "duration_trt_ombi"; // README: web form accepts only non-negative months
    const label = labelFor(s.name, s.label);
    const reference = (REF.variables[s.name] && REF.variables[s.name].reference) || "";
    const field = document.createElement("label");
    field.className = "field";
    field.innerHTML = `
      <span class="lbl">${esc(label)} <span class="unit">${esc(s.unit)}</span></span>
      <input id="${id}" name="${s.name}" type="number" step="any"
             ${nonNeg ? 'min="0"' : ""}
             placeholder="median ${fmt(s.imputation_median, 2)}"
             aria-label="${esc(label)} in ${esc(s.unit)}" />
      ${reference ? `<span class="range">${esc(reference)}</span>` : ""}`;
    wrap.appendChild(field);
  }
}

function readForm(model) {
  const raw = {};
  const outOfRange = [];
  for (const s of model.input_schema) {
    const el = document.getElementById("in_" + s.name);
    const str = el.value.trim();
    if (str === "") {
      raw[s.name] = null;
      continue;
    }
    let v = Number(str);
    if (s.name === "duration_trt_ombi" && v < 0) v = 0; // clamp per README
    raw[s.name] = v;
    if (v < s.observed_min || v > s.observed_max) outOfRange.push(labelFor(s.name, s.label));
  }
  return { raw, outOfRange };
}

// Short axis label for a predictor in the contribution chart.
function shortLabel(name) {
  return ({
    DAS28_FW_fup: "DAS28-ESR",
    CRP_fup: "CRP",
    duration_trt_ombi: "Treatment duration",
    orm1: "ORM1",
    fstl1: "FSTL1",
  })[name] || name;
}

// Render the diverging contribution-to-log-odds chart. Each term is coef*value;
// the intercept is shown too so the bars + intercept literally sum to eta.
function renderContributions(result) {
  const rows = [{ name: "(baseline / intercept)", contribution: result.intercept, imputed: false, intercept: true }]
    .concat(result.terms.map((t) => ({ ...t, label: shortLabel(t.name) })));
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.contribution)), 1e-9);
  const wrap = document.getElementById("contrib-bars");
  wrap.innerHTML = rows
    .map((r) => {
      const pos = r.contribution >= 0;
      const width = (Math.abs(r.contribution) / maxAbs) * 50; // % of half-track
      const cls = r.intercept ? "neutral" : pos ? "d2t" : "rem";
      const label = r.intercept ? "(baseline / intercept)" : r.label;
      const imp = r.imputed ? ' <span class="imp-tag">median</span>' : "";
      return `
        <div class="crow">
          <div class="cname">${esc(label)}${imp}</div>
          <div class="ctrack">
            <div class="cbar ${cls}" style="width:${width.toFixed(2)}%; ${pos ? "left:50%" : "right:50%"}"></div>
          </div>
          <div class="cval ${pos ? "pos" : "neg"}">${pos ? "+" : "−"}${fmt(Math.abs(r.contribution), 3)}</div>
        </div>`;
    })
    .join("");
}

function showResult(model, raw, outOfRange) {
  const result = predict(model, raw);
  const { p_d2t, p_rem, eta, imputed } = result;
  document.getElementById("result").hidden = false;
  document.getElementById("pct").textContent = fmt(100 * p_d2t, 1) + "%";
  const isD2T = p_d2t >= 0.5;
  const klass = document.getElementById("klass");
  klass.textContent = isD2T ? model.positive_class.toUpperCase() : model.negative_class.toUpperCase();
  klass.className = "v " + (isD2T ? "d2t" : "rem");
  document.getElementById("prem").textContent = fmt(100 * p_rem, 1) + "%";

  // Probability gauge bar + decision-boundary marker.
  const fill = document.getElementById("bar-fill");
  fill.style.width = (100 * p_d2t).toFixed(1) + "%";
  fill.className = "bar-fill " + (isD2T ? "d2t" : "rem");

  // "Why this score" chart + the resulting eta.
  document.getElementById("eta-val").textContent = fmt(eta, 3);
  renderContributions(result);

  const impLine = document.getElementById("imputed-line");
  if (imputed.length) {
    impLine.hidden = false;
    const labels = imputed.map((n) => labelFor(n, (model.input_schema.find((s) => s.name === n) || {}).label));
    document.getElementById("imputed").textContent = labels.join(", ");
  } else impLine.hidden = true;

  const oorLine = document.getElementById("range-line");
  if (outOfRange.length) {
    oorLine.hidden = false;
    document.getElementById("oor").textContent = outOfRange.join(", ");
  } else oorLine.hidden = true;
}

async function runSelfTest(model) {
  const tests = await loadTests();
  const status = document.getElementById("st-status");
  let worst = 0;
  let fails = 0;
  for (const t of tests) {
    const { p_d2t } = predict(model, t);
    const diff = Math.abs(p_d2t - t.pred_d2t);
    worst = Math.max(worst, diff);
    if (diff > TOL) fails++;
  }
  if (fails === 0) {
    status.textContent = `PASS (${tests.length}/${tests.length}, max Δ ${worst.toExponential(1)})`;
    document.getElementById("selftest").classList.add("ok");
  } else {
    status.textContent = `FAIL (${fails}/${tests.length} off, max Δ ${worst.toExponential(1)})`;
    document.getElementById("selftest").classList.add("bad");
  }
}

async function main() {
  MODEL = await loadJSON(MODEL_FILE, EMBEDDED_MODEL);
  REF = await loadJSON(REF_FILE, EMBEDDED_REF);
  buildForm(MODEL);
  document.getElementById("model-meta").textContent = `${MODEL.model_id} · v${MODEL.version || "?"}`;

  document.getElementById("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const { raw, outOfRange } = readForm(MODEL);
    showResult(MODEL, raw, outOfRange);
  });
  document.getElementById("form").addEventListener("reset", () => {
    document.getElementById("result").hidden = true;
  });

  runSelfTest(MODEL);
}

main();
