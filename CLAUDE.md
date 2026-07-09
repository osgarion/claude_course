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
  v rámci úkolů z kurzu potřeba.

## Průběh práce

- Úkoly zadává uživatel postupně podle kurzu, projekt se bude rozšiřovat.
- Tento soubor průběžně (stručně) aktualizovat o nové poznatky o projektu —
  ne o obsah kódu, ten je vidět v repozitáři.

## Architektura a konvence backendu

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
- Model e-shopu (stav po rozšíření): `Product` (+ `slug`, `category` FK,
  `is_active`, timestampy) → `ProductImage`, `ProductVariant` (varianta
  má vlastní cenu/stock, padá zpět na `product.price` přes `price`
  property); `Address`, `Order`, `OrderItem` (snapshot `unit_price`),
  `Payment` (jen evidence, žádná reálná platební brána), `Review`
  (moderace přes `is_approved`, `unique_together` product+user).
- Objednávky jen pro přihlášené (žádný guest checkout).
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
- `catalog/tests.py` existuje a pokrývá slug, skladovou kontrolu,
  souběžný nákup, permissions a `unique_together` recenzí — spouštět přes
  `python manage.py test catalog`.

## Referenční repo

- `https://github.com/jurab/eshop` — referenční implementace ze stejného
  kurzu, používá se jako checklist "má můj projekt všechno?". Neklonovat
  ani nekopírovat 1:1, jen porovnávat rozsah funkcí a případně inspirovat
  konvencemi.
- Odlišná architektura: app `products` (ne `catalog`), `ProductViewSet`
  (`ReadOnlyModelViewSet`) + DRF router místo generics view. Frontend běží
  na vlastním originu (`:3000`) přes `django-cors-headers` — u nás
  záměrně jinak (frontend servírovaný přes Django, žádné CORS).
- Dřívější mezery (`slug`/`is_active`/timestampy na Product, detail
  endpoint, bohatší `admin.py`, `tests.py`) jsou už doplněné. Category,
  Order/OrderItem/Payment/Review/Address/ProductVariant u nich vůbec
  nejsou — to máme navíc.

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
  Ukázková data (kategorie + produkty podle motivu "Pixel Pantry") a
  lokální superuser (`admin`/`admin`, jen pro dev) se zakládají přes
  `python manage.py shell -c "..."` (viz historie konverzace), ne
  fixture/migrací — při dalším čistém checkoutu je potřeba zopakovat.
