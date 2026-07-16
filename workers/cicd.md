# CI/CD — workers/ (Cloudflare Workers + GitHub Actions)

Štíhlá dvoustupňová pipeline: **test (na PR) → deploy prod (na main)**.
Inspirováno referenčním `jurab/eshop-ts`, ale záměrně bez dev tieru — držíme
paritu na úrovni funkcí, ne architektury (viz CLAUDE.md), a projekt má zatím
jednu produkční D1.

Workflowy žijí v **kořeni repa** (`.github/workflows/`), ne ve `workers/`,
protože GitHub Actions je čte jen odtamtud. Náš `workers/` je podsložka, takže
každý job má `working-directory: workers` a path-filtr `workers/**` — změny jen
v Django `backend/` deploy Workeru nespouštějí.

## Topologie

| Stupeň | Spouštěč | Co dělá | Klíče |
|---|---|---|---|
| **CI** | PR + push do main | `typecheck` + `npm test` (vitest v lokálním workerd) | žádné |
| **Deploy prod** | push do main | testy → migrace D1 → `wrangler deploy` → smoke test | Cloudflare token + account id |

Tok: feature větev → PR do `main` (CI ji gejtuje) → merge → deploy prod.
Testy běží i uvnitř deploy joby jako první krok, takže červený build se
k nasazení nedostane (kroky joby jsou sekvenční a při chybě se přeruší).

## Soubory

- `.github/workflows/ci.yml` — PR/push: `typecheck` + `test`. Bez klíčů, takže
  gejtuje i PR z forků, aniž by dostaly deploy práva.
- `.github/workflows/deploy-prod.yml` — push do main: `test → migrate → deploy →
  smoke`. `concurrency: deploy-prod` serializuje souběžná nasazení.

Smoke test = `curl … /api/products | grep '"slug"'`: ověří, že Worker po deployi
reálně odbaví request přes D1 (ne jen že se nahrál).

## Zbývá — HUMAN krok (jednorázově)

Deploy workflow potřebuje dva GitHub secrety. Dokud nejsou, CI (testy) prochází,
ale deploy spadne až na wrangler kroku.

1. **Cloudflare API token** — dashboard → My Profile → API Tokens → šablona
   **Edit Cloudflare Workers**, pak přidat oprávnění **Account · D1 · Edit**,
   scoped na účet `9f8090c87c8b0e64b5d857bc6886c299`. (Wrangler OAuth login
   tenhle token vytvořit neumí — nemá token-write scope.)

2. Nastavit oba secrety (account id není tajný, ale workflow ho čte odtud):

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN     # vlož token
   gh secret set CLOUDFLARE_ACCOUNT_ID -b 9f8090c87c8b0e64b5d857bc6886c299
   ```

3. Test naostro: mergem do `main` (nebo `gh workflow run "Deploy prod"`) a
   `gh run watch`.

## Vědomě neřešeno

- **Dev tier** (oddělená D1 + druhý Worker + větev `dev`) — reference ho má
  kvůli izolaci špatné migrace od produkce. Když ho budeš chtít, je to samostatný
  krok: `wrangler d1 create pixel-pantry-dev`, `env.dev` ve `wrangler.jsonc`,
  `deploy-dev.yml` na push do `dev`, a guard testy (nový node vitest projekt,
  protože `deploy --dry-run` potřebuje `child_process`, který ve workerd není).
- **Branch protection na `main`** vyžadující CI check (`gh api
  repos/osgarion/claude_course/branches/main/protection`, chce admin práva).
- **Stripe/Sentry secrety** — nechané prázdné záměrně (fail-safe: platba fake,
  Sentry vypnutý). Zapínají se přes `wrangler secret put …`, ne přes CI.

## Známé pasti

- **`d1 migrations apply <name>` bere jméno DB/binding**; bez `--env` míří na
  produkci. Náš deploy je jednoprostředí, takže `apply pixel-pantry --remote`
  je správně — ale kdyby přibyl dev tier, každý wrangler příkaz v `deploy-dev`
  MUSÍ nést `--env dev`, jinak tiše migruje produkci.
- **Migrace běží před nasazením nového kódu.** Aditivní změny OK; destruktivní
  jeď expand-then-contract přes dva deploye.
- **Free tier:** Actions je na public repu zdarma, Workers free plan se u 100k
  req/den zastaví (nefakturuje). Jeden Worker + jedna D1 = zdarma.
