# D2T teaching classifier — Cloudflare Worker

The deployable version of the app: a **Hono** Worker + **D1** database that serves
the static frontend, runs predictions, and (for logged-in users) stores per-user
assessments. Mirrors the `pixel-pantry` stack.

> **Teaching only.** Not for clinical decisions. `patient_label` is a user-chosen
> label, **not** real PHI — do not store real patient identifiers.

## How the pieces fit

- **Model math** lives in `src/model.ts`, a TypeScript port of `r-backend/R/predict.R`.
  It reads the frozen bundle (`public/d2t_teaching_augmented_firth_v1.json`), so all
  three implementations (R, browser JS, this Worker) share the same coefficients.
  `tests/model.test.ts` enforces agreement with the test-case CSV within `1e-10`.
- **The R backend stays the source of truth** for the model — it re-exports the
  bundle. The Worker only *reads* it. R is never deployed to Cloudflare.
- Saving an assessment **recomputes** the probability server-side, so stored values
  are authoritative and never trusted from the browser.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | – | model id/version |
| POST | `/api/auth/register` | – | create account → token |
| POST | `/api/auth/login` | – | login → token |
| GET | `/api/auth/me` | token | current user |
| POST | `/api/auth/logout` | token | revoke token |
| POST | `/api/predict` | – | teaching D2T-class probability |
| GET | `/api/assessments` | token | list your assessments |
| GET | `/api/assessments/next-id` | token | suggested `PT-000N` label |
| POST | `/api/assessments` | token | save (server recomputes) |
| DELETE | `/api/assessments/:id` | token | delete your assessment |

Auth wire format: `Authorization: Token <hex>` (same as pixel-pantry). Passwords are
PBKDF2-SHA256 hashed; only a SHA-256 hash of each token is stored.

## Setup & run

```bash
npm install
npx wrangler types                 # generate worker-configuration.d.ts (binding types)

# First time only — create the D1 DB, then paste the printed database_id into
# wrangler.jsonc (d1_databases[0].database_id):
npx wrangler d1 create d2t-detect

npm run db:migrate:local           # apply migrations to the local D1
npm run dev                        # http://localhost:8787
```

## Test & typecheck

```bash
npm test         # model parity gate (must pass within 1e-10)
npm run typecheck
```

## Deploy

```bash
npm run db:migrate:remote          # apply migrations to production D1
npm run deploy                     # publish to *.workers.dev
```

## Notes

- `AUTH_LIMITER` (rate limit) is a no-op locally and in tests; it only bites in
  production. Login/registration are throttled per-IP, per-colo.
- CI: add a workflow path-filtered to `d2t_detect/workers/**` (per the monorepo
  `CLAUDE.md` convention) so project runs don't mix.
