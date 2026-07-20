# D2T teaching classifier — R backend

A [plumber](https://www.rplumber.io/) REST API that serves the
`d2t_teaching_augmented_firth_v1` model by reading the **`.rds` bundle** directly
(`readRDS`). Same math as the static frontend, exposed over HTTP.

> **Teaching only.** Cross-sectional class probability, not a prospective D2T
> risk, not for clinical decisions.

## Layout

| File | Role |
|------|------|
| `R/predict.R` | Pure model logic (load bundle, median imputation, `plogis`). No web deps. |
| `plumber.R` | HTTP endpoints (`/health`, `/schema`, `/predict`, `/selftest`). |
| `run.R` | Launches the API. |
| `selftest.R` | Deployment gate — runs the synthetic cases without a server (CI-friendly). |

The bundle and test CSV live one level up (`../d2t_teaching_augmented_firth_v1.rds`,
`../d2t_teaching_augmented_firth_v1_test_cases.csv`). Override the bundle path with
the `D2T_BUNDLE` env var.

## Requirements

R (≥ 4.1, for the native `|>`-free code here any recent R works) plus:

```r
install.packages(c("plumber", "jsonlite"))
```

## Run

From this directory:

```bash
Rscript run.R              # http://127.0.0.1:8138
PORT=9000 Rscript run.R    # custom port
```

## Deployment gate

Must pass before serving — every synthetic case must match `.pred_d2t` within `1e-10`:

```bash
Rscript selftest.R         # exits non-zero on any failure
```

Or over HTTP once running: `GET /selftest`.

## Endpoints

### `GET /health`
Liveness + model identity.

### `GET /schema`
Input schema (labels, units, medians, observed ranges) so a client can build the
form from the bundle. Mirrors the frontend's use of the JSON.

### `POST /predict`
Body: JSON object with any of the five predictors. Omit a field or send `null` to
use its training median (reported back in `imputed`). Negative
`duration_trt_ombi` is clamped to 0 (per the known data issue).

```bash
curl -s http://127.0.0.1:8138/predict \
  -H 'Content-Type: application/json' \
  -d '{"DAS28_FW_fup":5.5,"CRP_fup":40,"duration_trt_ombi":60,"orm1":500000,"fstl1":20000}'
```

```json
{
  "p_d2t": 0.982600250036478,
  "p_rem": 0.017399749963522,
  "percent_d2t": 98.2600250036478,
  "predicted_class": "d2t",
  "imputed": [],
  "out_of_range": [],
  "disclaimer": "Teaching-only ... not for clinical decisions."
}
```

### `GET /selftest`
Runs the synthetic cases and returns pass/fail + max deviation. HTTP 500 if any
case is off tolerance.

## Notes

- The math lives once in `R/predict.R`; both the API and `selftest.R` source it, so
  the served model and the gate can never diverge.
- CORS is wide open (`*`) so the static frontend can call it from a browser; tighten
  the `cors` filter in `plumber.R` for any real deployment.
- The `.rds` `raw_scale` coefficients are already on the raw input scale — no
  standardization is applied, matching the JSON path.
