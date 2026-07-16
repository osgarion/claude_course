# Pixel Pantry — Cloudflare Workers + D1

Hlavní implementace e-shopu. Jeden Worker servíruje API (`/api/*`) i
statický frontend, takže vše běží na stejném originu (žádné CORS).

Django verze v `../backend/` je zmrazená referenční implementace — nové
funkce patří sem.

## Lokální vývoj

```sh
npm install
npx wrangler d1 migrations apply pixel-pantry --local   # schéma
npx wrangler d1 execute pixel-pantry --local --file=./seed.sql
npm run dev                                             # http://127.0.0.1:8787
```

## Testy

```sh
npm test              # všechno (54 testů)
npm run test:unit     # čistá logika, bez DB
npm run test:db       # skladová bezpečnost, souběh, rollback
npm run test:api      # plný request cyklus (guest tokeny, 404 vs 403)
npm run test:meta     # pravidla o kódu (hlídají bezpečnostní návrh)
npm run typecheck
```

## Nasazení

`wrangler login` je interaktivní, spusť ho sám:

```sh
npx wrangler login
npx wrangler d1 create pixel-pantry     # id vlož do wrangler.jsonc
npx wrangler d1 migrations apply pixel-pantry --remote
npx wrangler d1 execute pixel-pantry --remote --file=./seed.sql
npm run deploy
```

Účet provozovatele (`is_staff`) se zakládá přes API, protože heslo nejde
zahashovat v SQL:

```sh
curl -X POST https://<worker>.workers.dev/api/auth/register \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example.com","password":"<silne-heslo>"}'

npx wrangler d1 execute pixel-pantry --remote \
    --command "UPDATE users SET is_staff = 1 WHERE email = 'admin@example.com'"
```

Po každé změně bindingů v `wrangler.jsonc` spusť `npx wrangler types`.

## Co je jinak než v Django verzi

| | Django (`../backend`) | Workers + D1 (tady) |
|---|---|---|
| Přihlášení | session cookie + CSRF | token v `Authorization` hlavičce |
| Peníze | `Decimal` | celá čísla v halířích (API je vrací jako `"49.90"`) |
| ID objednávky | pořadové číslo | UUID (neuhodnutelné) |
| Sklad při souběhu | `SELECT FOR UPDATE` | `CHECK (stock >= 0)` + `db.batch()` |
| Admin | Django admin | zatím není (etapa 2) |
| Stripe, chatbot, obrázky | ano | etapa 2 |

Proč zrovna takhle a jaké to má důsledky — viz `../CLAUDE.md`.
