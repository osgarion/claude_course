# Pixel Pantry — backend

Django + Django REST Framework backend pro katalog produktů (jen čtení,
zatím žádné objednávky, košík ani přihlašování).

## Lokální spuštění

1. Vytvoř a aktivuj virtuální prostředí (odděluje závislosti tohoto
   projektu od zbytku systému):

   ```
   python3 -m venv .venv
   source .venv/bin/activate      # na Windows: .venv\Scripts\activate
   ```

2. Nainstaluj závislosti:

   ```
   pip install -r requirements.txt
   ```

3. Vytvoř databázi podle připravených migrací (založí soubor
   `db.sqlite3` a v něm tabulku pro `Product`):

   ```
   python manage.py migrate
   ```

4. (Volitelně) vytvoř si admin účet, ať se můžeš přihlásit do
   `/admin/` a ručně přidávat produkty:

   ```
   python manage.py createsuperuser
   ```

5. Spusť vývojový server:

   ```
   python manage.py runserver
   ```

## Kam se podívat

- `http://127.0.0.1:8000/api/products/` — seznam produktů (JSON, jen GET)
- `http://127.0.0.1:8000/admin/` — Django admin rozhraní pro správu dat

## Rozsah tohoto backendu

Zatím obsahuje jen model `Product` a jeho výpis. Objednávky, košík a
autentizace přijdou v dalších krocích kurzu.
