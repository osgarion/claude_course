# d2t_detect

Vlastní projekt uživatele v rámci kurzu. **Teaching-only** webová aplikace, která
klasifikuje established D2T RA (difficult-to-treat revmatoidní artritida) vs.
remisi pomocí augmented Firth logistické regrese. Není to prospektivní rizikový
model a nesmí sloužit ke klinickým rozhodnutím.

Obecný kontext uživatele a přehled ostatních projektů viz kořenový `../CLAUDE.md`.

## Stack

- **Frontend**: statické HTML/JS/CSS, bez build stepu a bez závislostí — stačí
  otevřít `index.html` (`index.html` + `app.js` + `styles.css`).
- **R reference** (`r-backend/`): R plumber REST API čtoucí přímo `.rds` bundle
  (`readRDS`). Čistá logika v `R/predict.R`, HTTP vrstva v `plumber.R`, spouštění
  `run.R` (port 8138), deployment gate `selftest.R` (běží i bez serveru).
  Endpointy: `/health`, `/schema`, `/predict`, `/selftest`. **Zůstává zdrojem
  pravdy modelu** (re-exportuje bundle); na Cloudflare se NEnasazuje (R tam
  neběží).
- **Deployable** (`workers/`): Cloudflare Worker (Hono + D1, TypeScript) —
  stejný stack jako pixel-pantry. Servíruje frontend (`public/`) + API na
  `/api/*`, login (PBKDF2 + token, převzato z pixel-pantry) a per-user ukládání
  hodnocení do D1. Model math v `src/model.ts` (port z `predict.R`, čte bundle
  JSON); parita s R/JS hlídaná `tests/model.test.ts` (tolerance `1e-10`). Server
  při ukládání probability PŘEPOČÍTÁVÁ (uložená hodnota je autoritativní).
  Patient label je jen štítek, ne PHI. Sekvenční ID `PT-000N` (editovatelné).
- Model je tak implementovaný 3× (R / prohlížeč JS / TS Worker) — všechny musí
  dávat shodné výsledky proti `..._test_cases.csv`.

## Model a data

- `d2t_teaching_augmented_firth_v1.json` — **zdroj pravdy**. App ho za běhu
  `fetch`uje, takže re-export bundlu se projeví bez zásahu do kódu. `app.js` má
  vloženou fallback kopii koeficientů + test cases pro běh přes `file://`
  (prohlížeč tam `fetch` blokuje).
- Pět vstupů (raw jednotky): DAS28-ESR, CRP (mg/L), trvání léčby (měsíce),
  ORM1 (ng/mL), FSTL1 (ng/mL). Prázdný vstup → `imputation_median` ze schématu.
- Výpočet: `eta = raw_scale_intercept + Σ raw_scale[j]*vstup[j]`,
  `p_d2t = 1/(1+exp(-eta))`. Koeficienty jsou už na raw scale — žádná
  standardizace navíc.
- Trvání léčby: form přijímá jen nezáporné měsíce (v trénovacích datech je
  záporná hodnota ponechaná kvůli reprodukovatelnosti manuskriptu; app ji
  clampuje na 0).

## Ověření

- Self-test v UI (patička) i ověřeno v Node: všechny 4 řádky z
  `..._test_cases.csv` sedí na `.pred_d2t` v toleranci `1e-10`
  (reálně max Δ ~3e-16). To je deployment gate z README.

## Pozn.

- README zmiňuje cesty mimo tuhle složku (`../../scripts/WRK_20_...R`,
  `reports/objects/...`) pro rebuild bundlu — v tomhle repu neexistují, rebuild
  odsud nepůjde.
- Pokud projekt dostane vlastní CI/CD, založit samostatný workflow
  v `.github/workflows/` s path-filtrem na `d2t_detect/**` (viz kořenový
  `CLAUDE.md`).
