# Claude Course

Studijní projekt zaměřený na Claude Code a AI agenty. Uživatel se učí prakticky
formou úkolů z kurzu. Repo je **monorepo** — každý projekt má vlastní podsložku
a vlastní `CLAUDE.md`; tenhle kořenový soubor je rozcestník.

## Kontext uživatele

- Mírně pokročilý vývojář (zná základy programování, s Claude Code/AI agenty
  začíná).
- Chce, aby Claude věci vysvětloval, ne jen mlčky implementoval — u nových
  konceptů, příkazů a rozhodnutí vždy stručně zdůvodnit "proč", ne jen "co".
- Preferuje kratší, srozumitelná vysvětlení před dlouhými výklady.

## Průběh práce

- Úkoly zadává uživatel postupně podle kurzu, projekty se budou rozšiřovat
  a přibývat.
- `CLAUDE.md` průběžně (stručně) aktualizovat o nové poznatky — obecné do
  tohohle kořenového, projektově specifické do `CLAUDE.md` dané podsložky.
  Ne o obsah kódu, ten je vidět v repozitáři.

## Projekty

- **`pixel-pantry/`** — e-shop (Cloudflare Workers + D1 jako hlavní
  implementace, zmražené Django jako reference). Nasazený na
  <https://pixel-pantry.pixel-pantry-course.workers.dev>. Detaily viz
  `pixel-pantry/CLAUDE.md`.
- **`d2t_detect/`** — vlastní projekt uživatele (zatím skeleton, zadání TBD).
  Viz `d2t_detect/CLAUDE.md`.

## Poznámky napříč repem

- **CI/CD** (`.github/workflows/`): workflowy musí zůstat v kořeni repa (GitHub
  Actions je jinde nenačte), ale jsou **path-filtrované na konkrétní projekt**
  (`pixel-pantry/workers/**`) a mají `working-directory` do dané podsložky.
  Nový projekt s vlastním CI dostane vlastní workflow se svým path-filtrem, ať
  se běhy projektů nemíchají.
- `.gitignore` je sdílený pro celé repo; cesty k projektově specifickým
  artefaktům (např. `pixel-pantry/backend/.env`) jsou plně kvalifikované.
