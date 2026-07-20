# Pixel Pantry — Cloudflare Workers + D1

Hlavní implementace e-shopu. Jeden Worker servíruje API (`/api/*`) i
statický frontend, takže vše běží na stejném originu (žádné CORS).

**Nasazeno (produkce, free tier):**
<https://pixel-pantry.pixel-pantry-course.workers.dev>

Django verze v `../backend/` je zmrazená referenční implementace — nové
funkce patří sem.

## Lokální vývoj

```sh
npm install
npx wrangler d1 migrations apply pixel-pantry --local   # schéma
npx wrangler d1 execute pixel-pantry --local --file=./seed.sql
npm run dev                                             # http://127.0.0.1:8787
```

Tajné klíče pro lokální běh: zkopíruj `.dev.vars.example` → `.dev.vars`
(gitignorovaný) a doplň. Bez nich e-shop běží dál (chat 503, platba fake,
Sentry vypnuté).

## Testy

```sh
npm test              # všechno (128 testů)
npm run test:unit     # čistá logika, bez DB
npm run test:db       # skladová bezpečnost, souběh, rollback
npm run test:api      # plný request cyklus (guest tokeny, 404 vs 403)
npm run test:meta     # pravidla o kódu (hlídají bezpečnostní návrh)
npm run typecheck
```

> Když se objeví `ECONNRESET` z poolu, kontroluj **počet** testů, ne jen barvu
> (`maxWorkers: 4` je pojistka proti tichému propadu test souborů).

## Nasazení

Průběžné nasazování jde přes **CI/CD** (`../.github/workflows/`, detaily
[`cicd.md`](./cicd.md)): PR → CI (typecheck + testy), merge do `main` →
`deploy-prod` (testy → migrace D1 → `wrangler deploy` → smoke test). Vyžaduje
GitHub secrety `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.

Ruční deploy (mimo pipeline) je pořád možný:

```sh
npx wrangler deploy
npx wrangler d1 migrations apply pixel-pantry --remote   # když přibyla migrace
```

Založení prostředí od nuly (nová D1 — takhle se produkce po zaseknuté DB
přestavěla):

```sh
npx wrangler login
npx wrangler d1 create pixel-pantry     # id vlož do wrangler.jsonc
npx wrangler d1 migrations apply pixel-pantry --remote
npx wrangler d1 execute pixel-pantry --remote --file=./seed.sql
npm run deploy
```

Po každé změně bindingů v `wrangler.jsonc` spusť `npx wrangler types`.

### Tajné klíče (produkce)

Jen jako **secret**, nikdy ve `wrangler.jsonc` (repo je veřejné). Klíč se
NESMÍ deklarovat jako `var` stejného jména — Cloudflare to odmítne na kolizi
(`code 10053`), viz poznámka ve `wrangler.jsonc` a `../CLAUDE.md`.

```sh
npx wrangler secret put SENTRY_DSN          # monitoring chyb (ZAPNUTO)
npx wrangler secret put ANTHROPIC_API_KEY   # chatbot
npx wrangler secret put STRIPE_SECRET_KEY   # reálné platby
```

### Účet provozovatele (`is_staff`)

Zakládá se přes API (heslo nejde zahashovat v SQL), pak povýšit v DB:

```sh
curl -X POST https://pixel-pantry.pixel-pantry-course.workers.dev/api/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example.com","password":"<silne-heslo>"}'

npx wrangler d1 execute pixel-pantry --remote \
    --command "UPDATE users SET is_staff = 1 WHERE email = 'admin@example.com'"
```

Po povýšení se na webu odhlas a znovu přihlas (token si nese `is_staff`) —
v navigaci naskočí odkaz **Admin** (`/admin`).

## Monitoring chyb

Neočekávané (ne-HTTP) chyby se zaznamenávají s celým popisem (metoda, cesta,
název, zpráva, stack):

- **Cloudflare Workers Logs** — vždy (`observability.enabled`), dohledatelné
  v dashboardu (Worker → Logs).
- **Sentry** (`@sentry/cloudflare`) — když je nastavené `SENTRY_DSN` (teď
  zapnuto), plný stack + kontext requestu, trvale a prohledávatelně.

## Co je hotové vs. odloženo

| | Django (`../backend`) | Workers + D1 (tady) |
|---|---|---|
| Přihlášení | session cookie + CSRF | token v `Authorization` hlavičce |
| Peníze | `Decimal` | celá čísla v halířích (API je vrací jako `"49.90"`) |
| ID objednávky | pořadové číslo | UUID (neuhodnutelné) |
| Sklad při souběhu | `SELECT FOR UPDATE` | `CHECK (stock >= 0)` + `db.batch()` |
| Admin rozhraní | Django admin | ✅ `/admin` (produkty, obrázky, kupóny, uživatelé, objednávky, recenze) |
| Chatbot (Claude) | ✅ | ✅ |
| Stripe platby | ✅ backend | ✅ backend (Elements frontend odložen) |
| Obrázky produktů | ✅ soubory | ✅ URL-based (R2 upload odložen) |
| Sentry | ✅ | ✅ |
| CI/CD | — | ✅ GitHub Actions (viz `cicd.md`) |

Proč zrovna takhle a jaké to má důsledky — viz `../CLAUDE.md`.
