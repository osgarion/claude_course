# Claude Course

Studijní projekt zaměřený na Claude Code a AI agenty. Uživatel se učí prakticky
formou úkolů z kurzu, které mu bude postupně zadávat.

## Kontext uživatele

- Mírně pokročilý vývojář (zná základy programování, s Claude Code/AI agenty
  začíná).
- Chce, aby Claude věci vysvětloval, ne jen mlčky implementoval — u nových
  konceptů, příkazů a rozhodnutí vždy stručně zdůvodnit "proč", ne jen "co".
- Preferuje kratší, srozumitelná vysvětlení před dlouhými výklady.

## Nástroje a účty

- GitHub: k dispozici pro verzování a případné PR workflow.
- Cloudflare: k dispozici pro nasazení (Pages/Workers) — použít až to bude
  v rámci úkolů z kurzu potřeba. Pro nasazení tohoto e-shopu je záměr
  Workers (rychlé API) + D1 (Cloudflare SQL databáze) na free tier —
  detaily/postup viz až se k nasazení skutečně dostaneme (aktuální
  Django+SQLite backend poběží dál lokálně, D1 je pro cloud verzi).
- Anthropic API: `ANTHROPIC_API_KEY` pohání chatbota (viz níže) — klíč
  jen v `backend/.env` (Django) a `workers/.dev.vars` (Workers, lokálně) /
  `wrangler secret put ANTHROPIC_API_KEY` (Workers, produkce). Nikdy v kódu
  ani v konverzaci natvrdo napsaný (pokud se to stane omylem, klíč se
  považuje za prozrazený a je potřeba ho v Anthropic konzoli rotovat).

## Průběh práce

- Úkoly zadává uživatel postupně podle kurzu, projekt se bude rozšiřovat.
- Tento soubor průběžně (stručně) aktualizovat o nové poznatky o projektu —
  ne o obsah kódu, ten je vidět v repozitáři.

## Kde je co (POZOR: dvě implementace)

- **`workers/` = hlavní implementace** (Cloudflare Workers + D1, TypeScript,
  Hono). Sem patří nové funkce.
- **`backend/` = ZMRAZENÁ Django referenční implementace.** Zůstává jako
  učební materiál a srovnání, ale nové funkce se do ní **nepřidávají** —
  jinak by se všechno dělalo dvakrát. Když někdo požádá o změnu funkce
  obchodu, jde do `workers/`.
- Django ani FastAPI na Workers spustit nejde (Workers běží JS/TS, D1 není
  přístupná přes Django ORM) — proto přepis, ne migrace.

## Cloudflare Workers + D1 (`workers/`)

Nasazení: free tier, `*.workers.dev` subdoména. **Jeden Worker servíruje
API i statický frontend** (`assets` binding + `run_worker_first` na
`/api/*`), takže stejný origin a žádné CORS — stejný princip jako u Djanga.

Nejdůležitější věci, které jinde nezjistíš:

- **Sklad při souběhu: `CHECK (stock >= 0)` + `db.batch()`.** D1 nemá
  `SELECT FOR UPDATE` ani interaktivní transakce. `db.batch()` *je* SQL
  transakce (při chybě se celá vrátí zpět), ale `UPDATE`, který netrefí
  žádný řádek, **není chyba** — takže podmíněný `WHERE stock >= ?` by tiše
  commitnul objednávku bez odečtu skladu. Řešení: odečet je nepodmíněný a
  o přetečení pod nulu se postará CHECK constraint ze schématu, který
  shodí celý batch. Nesahat na to bez přečtení komentářů v
  `workers/src/services/order.ts`; hlídá to meta test.
- **Objednávky mají UUID primární klíč**, protože ID musíme znát *před*
  sestavením batche (položky na něj odkazují a v batchi nejde přečíst
  výsledek předchozího statementu). Bonus: cizí ID nejdou uhodnout.
- **Zrušení a platba se „zabírají" podmíněným UPDATEm** (`WHERE status =
  'pending'` / `IN ('pending','paid')`) — jinak by dvojí zrušení vrátilo
  sklad dvakrát a dvojklik na „Zaplatit" založil dvě platby. Známé okno:
  když Worker umře mezi zabráním a vrácením skladu, zboží se nevrátí
  (selhává konzervativně — spíš neprodáme, než abychom prodali dvakrát).
- **Peníze jsou celá čísla v halířích** (`*_cents`), nikdy float. API je na
  výstupu převádí zpět na řetězce (`"49.90"`), takže tvar odpovědi sedí
  s Django verzí.
- **Auth je token-based** (token v `Authorization: Token <hex>`, na frontendu
  v `localStorage`) — Workers nemají session framework. CSRF tím odpadá.
  V DB je uložený jen sha256 tokenu, ne holý token.
- **Hesla: PBKDF2 přes Web Crypto, ~100k iterací.** workerd PBKDF2 zastropuje
  na 100k a free plan má 10 ms CPU/request, takže je to **znatelně slabší než
  Django** (~1,2M iterací). Je to daň za free tier, ne omyl. Silnější hashování
  by chtělo Workers Paid.
- **Rate limiting** je Workers Rate Limiting binding — per-colo a eventually
  consistent, tedy **zmírnění zneužití, ne bezpečnostní hranice** (DRF
  throttling byl přesný). Když binding chybí (testy, `wrangler dev`), je
  middleware no-op.
- Bezpečnostní invarianty (cizí záznam → 404 ne 403; guest objednávka jen
  přes `guest_token`, nikdy podle „user je NULL") jsou stejné jako v Djangu
  a vynucené meta testy v `workers/tests/meta/`.
- Anonymní zákazník **nesmí** poslat cizí `shipping_address` podle ID (musí
  použít `shipping_address_input`) — v Django verzi je to otevřená mezera,
  tady je vědomě zavřená.
- **Objednávka je historie, ne pohled do katalogu.** `order_items`
  snapshotuje `product_name` i `unit_price_cents`, a `product_id` je
  `ON DELETE SET NULL` (migrace `0002`). Produkt jde tedy z katalogu smazat
  i přejmenovat, aniž by to přepsalo, co si zákazník koupil. Pozor: zrušení
  objednávky proto musí položku bez `product_id` přeskočit (není kam vracet
  sklad) — viz `cancelOrder()`.
- **Zákaznický chatbot** (Claude Haiku, `claude-haiku-4-5`):
  `POST /api/chat` (`src/routes/chat.ts`) + `src/services/assistant.ts`,
  plovoucí widget na index/produkt/pokladna (`public/static/chat.js` si
  vykresluje vlastní DOM, ať se markup nekopíruje do tří HTML; historie
  v `sessionStorage`). Smyčku nástrojů řídí `client.beta.messages.toolRunner`
  z `@anthropic-ai/sdk`, nástroje se definují přes `betaTool` (raw JSON
  schema, ne zod helper).
  **Bezpečnostní princip — klíčové i pro budoucí AI funkce:** obrana proti
  prompt injection NESTOJÍ na tom, že model poslechne systémový prompt, ale
  na tom, co kód vůbec umí. Žádný nástroj nebere identitu zákazníka jako
  parametr od modelu — nástroje se vyrábějí uvnitř requestu a přes closure
  vidí jen uživatele ověřeného z tokenu, takže pro identitu ve schématu
  prostě neexistuje políčko. Objednávky se i tady načítají výhradně přes
  `accessibleOrder()`. `list_my_orders` se nepřihlášenému do nabídky vůbec
  nezařadí (model o něm neví). Nástroje jsou jen pro čtení. Všechno tohle
  hlídají meta testy — nesahat na to bez jejich přečtení.
  Bez `ANTHROPIC_API_KEY` vrací endpoint 503 (fail-closed). Rate limit
  `CHAT_LIMITER` (20/min) kvůli nákladům na API.
- `@anthropic-ai/sdk` si vyžádal `"compatibility_flags": ["nodejs_compat"]`
  ve `wrangler.jsonc` — bez toho workerd při importu SDK spadne.
- `GET /api/products?category=<slug>` filtruje podle kategorie (parita
  s referenčním repem); bez parametru se chová jako dřív.
- **Stripe platby — jen backend, frontend vědomě odložený** (stejný
  precedent jako Django `backend/`): `POST /api/orders/:id/pay` s nastaveným
  `STRIPE_SECRET_KEY` založí/znovupoužije PaymentIntent (`src/services/
  stripe.ts`, `payment_method_types: ["card"]` — bez Stripe Elements ve
  frontendu nemáme kam přesměrovat platby vyžadující redirect). Bez klíče
  beze změny fake platba jako dřív (`payOrder()`). `POST /:id/confirm_payment`
  (sync záloha k webhooku) a `POST /api/stripe/webhook` (ověření podpisu přes
  `constructEventAsync` + `Stripe.createSubtleCryptoProvider()` — Workers
  nemá Node crypto synchronní HMAC) obě volají sdílený `markOrderPaid()`
  (vytažený z `payOrder()`), idempotentní stejným vzorem jako zbytek
  objednávek (`WHERE status = 'pending'` claim). Webhook nemá auth ani rate
  limit — hranice důvěry je jen ověřený podpis; objednávku hledá přímým
  `SELECT ... WHERE id = ?`, ne přes `accessibleOrder()` (Stripe nemá
  uživatelský token ani guest_token). `stripe` npm balíček má explicitní
  `workerd` export podmínku — netřeba ručně `Stripe.createFetchHttpClient()`,
  balíček se sám inicializuje na fetch/Web Crypto pro edge runtime.
  Žádná nová D1 migrace — `orders.payment_intent_id` a `payments.provider`
  byly připravené od začátku. Testy (`tests/db/stripe.test.ts`) používají
  ruční `StripeClient` fake (DI, žádná mock knihovna) — žádné síťové volání
  na Stripe API, stejný vzor jako u testů chatbota.
  **Známé vědomé omezení:** souběh při zápisu `payment_intent_id` (dva rychlé
  "Zaplatit" kliky) není zamčený — benigní osiřelý intent, ne dvojí platba.
  Stripe Elements formulář v `pokladna.html` zatím není zapojený.
- **Admin rozhraní** (`public/admin.html` + `public/static/admin.js`, staff-only
  CRUD API): žádná nová D1 migrace, jen nové endpointy přes existující
  `requireStaff` middleware (`src/auth/middleware.ts`) — stejný vzor jako
  dosavadní kategorie (`categories.ts`).
  - `POST/PATCH/DELETE /api/products`(`/:id`) — CRUD produktů (základní
    pole; varianty stále odložené). `GET /api/products?all=1` funguje jen pro
    `is_staff` (jinak se tiše ignoruje, stejný vzor jako `onlyApproved`
    u recenzí) a ukáže i neaktivní produkty.
  - **Obrázky produktu (URL-based):** `GET/POST /api/products/:id/images` +
    `DELETE /api/products/:id/images/:imageId` (vše `requireStaff`). Ukládá se
    jen odkaz (`image_url`), ne nahraný soubor — R2 upload zůstává vědomě
    v Etapě 2 (referenční `eshop-ts` ho taky reálně nepoužívá, R2 na účtu
    nemá). Nastavení nového `is_primary` shodí ostatní primární v `db.batch()`
    (jeden primární na produkt). Samostatný staff `GET .../images` existuje,
    protože veřejný detail produktu je gated na `is_active = 1` a admin
    potřebuje vidět obrázky i u neaktivních. Cizí kombinace id/produktu → 404.
  - `src/routes/coupons.ts` — na rozdíl od kategorií/produktů je **celé**
    (i `GET` seznamu) za `requireStaff` — kupónové kódy jsou obchodní
    detail, ne veřejný katalog. Nový `serializeCoupon()`.
  - `GET /api/orders/admin` (musí být v `orders.ts` zaregistrovaná PŘED
    `/:id`, ať Hono nezkusí "admin" vzít jako ID objednávky) — výpis napříč
    zákazníky, mimo `accessibleOrder()` (ten je pro vlastníka/hosta, tohle je
    pro provozovatele). Umí `?status=` (jen z platných stavů, neznámý se
    ignoruje) a `?search=` (LIKE přes e-mail zákazníka). `POST /:id/ship` —
    hlídaný přechod jen `paid → shipped`, přes `UPDATE ... WHERE status =
    'paid' RETURNING *` (stejný "claim" vzor jako placení, žádný nový holý
    dotaz na tabulku orders podle id, který by trefil počítadlo ve stávajícím
    meta pravidle).
  - `GET /api/orders/admin/:id` (taky před `/:id`) — detail pro provozovatele
    **přes JOIN** (`SELECT o.*, u.email FROM orders o LEFT JOIN users u ...`),
    NE holý `SELECT * FROM orders WHERE id = ?` — to hlídá meta počítadlo
    (stropuje počet takových dotazů). **Pozor i na komentáře:** regex v
    `rules.test.ts` nerozlišuje kód od komentáře, takže tu frázi nesmí
    doslovně obsahovat ani vysvětlivka. `POST /api/orders/admin/bulk-ship`
    (`{ids: []}`) — hromadné odeslání, každé id stejným podmíněným claimem
    v jednom `db.batch()`, vrací počet reálně odeslaných.
  - `PATCH /api/reviews/:id` (nový `src/routes/reviews.ts`) — prosté přepnutí
    `is_approved`, žádná samostatná schvalovací akce (stejně jako Django
    admin `list_editable`).
  - **Správa uživatelů** (`src/routes/adminUsers.ts`, mount `/api/admin/users`,
    celé za `requireStaff`): `GET /` (+ `?search` přes e-mail/jméno/příjmení),
    `PATCH /:id` (přepnutí `is_staff`/`is_active`, obě pole volitelná). Hesla
    se sem vědomě nedávají. **Pojistka proti sebe-zamčení:** provozovatel si
    přes svůj vlastní účet nesmí odebrat `is_staff` ani se deaktivovat (→ 400)
    — přes cizí účet ano. Reference tuhle pojistku nemá.
  - `serializeUser()` teď vrací i `is_staff`, `is_active` a `date_joined`
    (dřív ne) — `is_staff` kvůli odkazu "Admin" v navigaci
    (`public/static/auth.js`), `is_active`/`date_joined` kvůli výpisu
    uživatelů. Skutečné vynucení je vždy server-side (`requireStaff` na každém
    requestu); klientská kontrola na `admin.html` je jen UX.
  - Lokální povýšení na staff: `npx wrangler d1 execute pixel-pantry --local
    --command "UPDATE users SET is_staff = 1 WHERE email = '...'"`.
- Testy: `npm test` ve `workers/` (vitest + `@cloudflare/vitest-pool-workers`,
  běží proti reálnému Workers runtime a D1). Vrstvení unit/db/api/meta jako
  u pytestu. `npx wrangler types` po každé změně bindingů.
  `maxWorkers: 4` ve `vitest.config.ts` je pojistka: každý test soubor =
  vlastní workerd s celým bundlem (včetně SDK) a při plné paralelizaci
  workerdy padaly — a vitest pak hlásil suitu **zeleně**, protože testy ze
  spadlých souborů zmizely z počtu. Když se objeví `ECONNRESET` z poolu,
  kontrolovat počet testů, ne jen barvu.
- **Sentry** (`src/sentry.ts`, `@sentry/cloudflare`): `withSentry(app)` obaluje
  export ve `src/index.ts`, feature-gated přes `SENTRY_DSN` (prázdné = no-op,
  stejný fail-safe vzor jako `ANTHROPIC_API_KEY`/`STRIPE_SECRET_KEY`). Do
  `app.onError` přidán `Sentry.captureException(error)` jen pro neočekávané
  (ne-HTTP) chyby a jen když je DSN nastavené. DSN nikdy natvrdo — `wrangler.jsonc`
  `vars` má prázdnou deklaraci, skutečná hodnota přes `.dev.vars` (lokálně) /
  `wrangler secret put SENTRY_DSN` (produkce).
- **Etapa 2 — zbývá už jen R2 upload obrázků souborů** (URL-based obrázky ✅,
  viz admin výš). Hotové: chatbot ✅, Stripe backend ✅, admin rozhraní ✅
  (vč. správy uživatelů, obrázků, filtrů/hromadného odeslání objednávek),
  Sentry ✅. Stripe Elements frontend zůstává vědomě odložený.

## Architektura a konvence backendu (Django — ZMRAZENO, jen reference)

- Django + DRF, jedna app `catalog` v `backend/`. Nové entity (podobné
  Product/Category) sem patří, není důvod zakládat další app.
- Endpointy jako obecné DRF generics view (`ListAPIView`,
  `ListCreateAPIView`, `RetrieveUpdateDestroyAPIView`) přes `path()`
  v `catalog/urls.py` — v projektu se zatím nepoužívají ViewSety ani
  DRF routery, držet se stejného stylu.
- Role "owner" = Django `is_staff` flag (žádný vlastní User model/pole
  role). Permission třídy jsou v `catalog/permissions.py`
  (`IsOwnerOrReadOnly`: čtení všem, zápis jen ownerům).
- Frontend (`index.html`/`app.js`/`styles.css`) je servírovaný ze
  stejného originu jako API přes Django templates/static (ne jako
  samostatný statický web) — díky tomu není potřeba CORS ani
  `django-cors-headers`.
- Slug pole (Category, Product) se odvozuje z `name` přes `slugify()`
  v `save()`, pokud není zadané ručně.
- Druhá permission vrstva: `IsOwnerOfObject` (`catalog/permissions.py`)
  pro záznamy patřící zákazníkovi (Address/Order/Review) — jiný koncept
  než `IsOwnerOrReadOnly` (ten je pro "provozovatel obchodu" = `is_staff`).
  Detail view navíc vždy filtruje `get_queryset()` na `request.user`, aby
  cizí záznam vracel 404 (ne 403, což by prozradilo jeho existenci).
- Model e-shopu (stav po rozšíření): `User` (custom, e-mail login),
  `Product` (+ `slug`, `category` FK, `is_active`, timestampy) →
  `ProductImage`, `ProductVariant` (varianta má vlastní cenu/stock, padá
  zpět na `product.price` přes `price` property); `Address` (nullable
  `user` kvůli guestům), `Coupon` (percent/pevná sleva, platnost od-do),
  `Order` (nullable `user`, `guest_token`, `coupon`, `subtotal`/
  `discount_amount`/`total`, `payment_intent_id`), `OrderItem` (snapshot
  `unit_price`), `Payment` (`provider` fake/stripe, `transaction_id`),
  `Review` (moderace přes `is_approved`, `unique_together` product+user).
- Objednávky i pro nepřihlášené (guest checkout přes `guest_token`, viz
  výš) — dřívější rozhodnutí "jen pro přihlášené" bylo vědomě otočeno
  při rozšíření na paritu s referenčním repem.
- Skladová kontrola/souběžný nákup posledního kusu: `select_for_update()`
  uvnitř `transaction.atomic()` v `OrderSerializer.create()` — ne
  samostatný model. Řešení je v `catalog/serializers.py`.
- `unique_together` na `Review` se u `ModelSerializer` nevaliduje
  automaticky, když `product`/`user` nejsou zapisovatelná pole serializeru
  (jdou z URL/requestu) — kontrola duplicity je ručně v
  `ReviewListCreateAPIView.perform_create`.
- Frontend má teď i login/logout (Django `django.contrib.auth.urls`),
  stránku detailu produktu (`/produkt/<slug>/`) a pokladnu (`/pokladna/`).
  Košík se mezi stránkami předává přes `localStorage` (víceres stránkový
  web, ne SPA). CSRF token pro fetch POST se čte z `csrftoken` cookie
  (nastaví ji `{% csrf_token %}` na stránce).
- Custom `User` model (`catalog.User`, `AUTH_USER_MODEL = "catalog.User"`):
  login e-mailem, žádné pole `username`. Vyžádalo si to jednorázový reset
  historie migrací (nový `0001_initial.py` obsahuje rovnou celé schéma) -
  lokální `db.sqlite3` a vzorová data se po fresh checkoutu zakládají
  znovu (viz "Poznámky k prostředí"), superuser je teď
  `admin@example.com`/`admin` (dřív `admin`/`admin` přes username).
- Guest checkout: `Order.user` je nullable (`SET_NULL`), anonymní
  objednávka dostane `guest_token` (UUID, vrácený jen jednou v odpovědi
  na create) - host jím prokazuje přístup ke své objednávce (GET/pay/
  cancel), místo přihlášení. `IsOwnerOfObject.has_object_permission`
  proto explicitně vyžaduje `request.user.is_authenticated`, jinak by
  "None == None" (anonymní request i guest objednávka mají `user_id is
  None`) omylem pustilo kohokoli k cizí guest objednávce - guest přístup
  řeší `_accessible_order()` v `catalog/views.py`, ne obecná permission
  třída. `Address.user` je z téhož důvodu taky nullable (guest adresa).
- `Coupon` model (percent/pevná sleva, platnost od-do) + `Order.subtotal`/
  `discount_amount`/`total` počítané a zmražené při vytvoření objednávky
  v `OrderSerializer.create()` (`discount_for()`/`is_valid_now()` jsou
  čistá logika, testované v `tests/unit/`). Endpoint
  `POST /api/coupons/validate/` pro průběžnou kontrolu kódu v checkoutu.
- Platby: `OrderPayAPIView` bez nastaveného `STRIPE_SECRET_KEY` (prázdné
  ve výchozím stavu) rovnou simuluje okamžitě úspěšnou platbu jako dřív.
  Se Stripe klíčem (jen v `backend/.env`, gitignored, nikdy natvrdo v
  kódu) založí/vrátí PaymentIntent (`catalog/stripe_gateway.py`) a stav
  se potvrdí přes `POST /orders/<pk>/confirm_payment/` (sync fallback)
  nebo `POST /api/stripe/webhook/` (podpis ověřený, bez auth/throttlingu
  - volá ho Stripe, ne uživatel). Stripe Elements formulář v
  `checkout.html` zatím **není** zapojený (checkout zůstává na
  jednoduchém "Zaplatit" tlačítku) - je to vědomě odložené na
  samostatný následující úkol, backend API je hotové a otestované
  (mockovaně, `tests/api/test_payments.py`).
- `OrderCancelAPIView` (`POST /orders/<pk>/cancel/`) zruší objednávku a
  vrátí zásoby na sklad přes `Order.cancel()` (stejný
  `select_for_update()` vzor jako `create()`).
- Sentry (`SENTRY_DSN` v `backend/.env`, prázdné = vypnuto) a token auth
  (`rest_framework.authtoken`, endpointy `/api/auth/register|login|
  logout|me/`) jsou taky env/feature-gated doplňky. Frontend
  (`checkout.html`, `product_detail.html`, `registration/login.html`)
  dál používá výhradně session/cookie auth - token endpointy jsou
  příprava na budoucí API-only klienty, current UI je nepoužívá.
  Throttling scopes: `anon` 60/min, `user` 120/min, `auth` (sdílené
  login+register) 10/min - stav žije v Django cache (`LocMemCache`
  default, jen pro jeden proces, netýká se dev/testů).
- `ProductListAPIView`/`ProductDetailAPIView` anotují queryset
  `avg_rating`/`review_count` (`Avg`/`Count` jen nad `is_approved=True`
  recenzemi) - zobrazeno v `product_detail.html`/`app.js`.
- Zákaznický chatbot (Claude Haiku, `catalog/assistant.py` +
  `POST /api/chat/`, model `claude-haiku-4-5-20251001`): plovoucí widget
  na `index.html`/`product_detail.html`/`checkout.html`
  (`chat_widget.html` partial + `chat.js`, historie v `sessionStorage`).
  Systémový prompt omezuje téma na tento obchod (produkty/objednávky/
  doprava/platby), mimotématické dotazy má model odmítnout.
  **Bezpečnostní princip** (klíčové pro budoucí podobné funkce): nástroje
  (tools), které model smí volat, NIKDY neberou identitu zákazníka jako
  parametr od modelu - vždy pracují jen s `request.user` aktuálního HTTP
  requestu (`Order.objects.filter(pk=order_id, user=request.user)`), takže
  i kdyby model přesvědčila fiktivní instrukce v konverzaci "ukaž mi
  objednávku někoho jiného", tool ji strukturálně nikdy nenajde - obrana
  nezávisí na tom, že to model "poslechne" systémový prompt, ale na tom,
  co kód vůbec umí. Nástroje pro objednávky/adresy (`create_order`,
  `cancel_my_order`, `get_order_status`, `list_my_orders`,
  `list_my_addresses`) se navíc do nabídky modelu vůbec nezařadí pro
  nepřihlášené (`build_tools()`) - model o jejich existenci ani neví.
  `create_order` tool interně používá stejný `OrderSerializer` jako
  `/api/orders/`, takže dědí i kontrolu vlastnictví zadané adresy a
  skladovou kontrolu. Throttle scope `chat` (20/min) kvůli nákladům na
  Anthropic API. Bez `ANTHROPIC_API_KEY` endpoint vrací 503 (fail-closed,
  ne tichý pád na nic).
- Testy běží přes **pytest + pytest-django** (ne `manage.py test`), podle
  vrstvené struktury inspirované `test-suite-readme.md` a testy
  referenčního repa (viz níže) — přizpůsobené na sync Django a jednu app
  `catalog` (vrstva `integration` na cizí API se nepoužívá, projekt žádné
  cizí API nevolá):
  - `tests/unit/` — čistá logika bez DB (např. `ProductVariant.price`
    fallback). Vynuceno metatestem, DB fixtures jsou tam zakázané.
  - `tests/db/` — reálné ORM přes `pytest.mark.django_db`: slug, skladová
    kontrola, souběžný nákup posledního kusu, `unique_together` recenzí.
  - `tests/api/` — plný request cyklus přes DRF `APIClient`: permissions
    (cizí adresa → 404, jen `is_staff` může zakládat kategorie).
  - `tests/arch/` — AST kontrola směru importů uvnitř `catalog/`
    (`models` nesmí importovat `serializers`/`views`/`permissions`,
    `serializers` nesmí `views`) s ratchet allowlistem
    (`tests/arch/allowlist.py`, teď prázdný).
  - `tests/meta/` — pravidla o samotné test suite (unit testy nesmí sahat
    na DB/APIClient, každý `test_*.py` musí být ve známé podsložce).
  - Sdílené fixtures v `tests/conftest.py` (`api_client`, `auth_client`,
    `user`, `staff_user`, `make_address`, `make_product`).
  - Spouštění: `make test` (jen unit) / `make test-db` / `make test-api`
    / `make test-arch` / `make test-meta` / `make test-all` (Makefile v
    `backend/`), nebo přímo `.venv/bin/pytest tests/<slozka>`.
  - `pytest`, `pytest-django` jsou v `requirements.txt`; nastavení je v
    `backend/pytest.ini`.

## Referenční repo

- `https://github.com/jurab/eshop` — referenční implementace ze stejného
  kurzu, používá se jako checklist "má můj projekt všechno?". Neklonovat
  ani nekopírovat 1:1, jen porovnávat rozsah funkcí a případně inspirovat
  konvencemi.
- Odlišná architektura: app-split `accounts`/`products`/`orders` (ne
  jedna `catalog`), ViewSety (`ReadOnlyModelViewSet`,
  `GenericViewSet`+mixiny) + DRF router místo generics view. Frontend
  běží na vlastním originu (`:3000`) přes `django-cors-headers` — u nás
  záměrně jinak (jedna app `catalog`, generics+`path()`, frontend
  servírovaný přes Django, žádné CORS) — parita se řeší na úrovni
  funkcí, ne kopírováním jejich architektury.
- Repo mezitím dost narostlo (od poslední kontroly): custom `User`
  (e-mail login), guest checkout, `Coupon`, reálná Stripe platební
  brána (`stripe_gateway.py`), Sentry, DRF token auth + throttling,
  akce `pay`/`cancel`/`confirm_payment` na objednávce, agregace
  hodnocení (`avg_rating`/`review_count`), admin smoke test — funkční
  paritu s tímhle stavem jsme dohnali (viz sekce výš), Sentry DSN a
  Stripe klíče se ale **nekopírují** natvrdo jako u nich v `settings.py`
  (u nás jen přes `backend/.env`, viz "Poznámky k prostředí"), a Stripe
  Elements UI v checkoutu je zatím záměrně odložené.

## Poznámky k prostředí

- V sandboxu Claude Code chybí `pip`/`venv` a nejde použít `sudo`
  (vyžaduje interaktivní heslo) — `makemigrations`/`migrate`/`runserver`
  je potřeba spouštět buď u uživatele lokálně, nebo (pokud už `.venv`
  v `backend/` existuje) přímo v sandboxu přes `source .venv/bin/activate`.
- Sandbox běží na Python 3.14 (velmi nová verze) — starší pinované
  verze balíčků bez horní hranice pryč od "latest" nemusí mít pro ni
  prebuilt wheel (typicky Pillow). `requirements.txt` proto nechává
  Pillow bez horní hranice verze (`Pillow>=10.0`), ať si pip vybere
  nejnovější kompatibilní wheel.
- Media soubory (nahrané obrázky přes Pillow/`ImageField`) jdou do
  `backend/media/`, které je v `.gitignore` stejně jako `db.sqlite3`.
- `db.sqlite3` je lokální a negitovaný — po čerstvém `migrate` je prázdný.
  Ukázková data (kategorie + produkty podle motivu "Pixel Pantry",
  ukázkové kupóny `WELCOME10`/`FLAT50`/`EXPIRED10`) a lokální superuser
  (`admin@example.com`/`admin`, jen pro dev — e-mail, ne username, viz
  custom User model výš) se zakládají přes `python manage.py shell -c
  "..."` (viz historie konverzace), ne fixture/migrací — při dalším
  čistém checkoutu je potřeba zopakovat.
- `backend/.env` (gitignored, šablona v `backend/.env.example`) drží
  lokální tajné klíče — Stripe (`STRIPE_SECRET_KEY`/`STRIPE_
  PUBLISHABLE_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_CURRENCY`) a Sentry
  (`SENTRY_DSN`). Nikdy se neukládají natvrdo do `settings.py` ani do
  gitu; `settings.py` je čte přes `os.environ.get(...)` s prázdným
  defaultem (`python-dotenv` načte `.env`, pokud existuje). Testy běží
  vždy s prázdnými hodnotami (`PYTEST_VERSION` guard v `settings.py`),
  Stripe volání jsou proto v testech vždy mockovaná.
