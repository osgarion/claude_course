"""
Django settings for the Pixel Pantry backend.

Toto je hlavní konfigurační soubor projektu - Django ho čte při každém
startu a řídí se jím (jaké aplikace jsou zapnuté, jaká databáze se používá
atd.). Je to standardní soubor, jaký by vygeneroval `django-admin
startproject`, jen ručně upravený pro naše potřeby.
"""

from pathlib import Path

# BASE_DIR = cesta ke složce backend/ (o dvě úrovně nad tímto souborem)
BASE_DIR = Path(__file__).resolve().parent.parent

# POZOR: tajný klíč pro lokální vývoj. Před nasazením do produkce se musí
# nahradit vlastní tajnou hodnotou a NESMÍ se commitovat do veřejného repa.
SECRET_KEY = "django-insecure-local-dev-only-change-me"

# DEBUG = True zobrazuje detailní chybové stránky - hodí se při vývoji,
# v produkci se MUSÍ vypnout (jinak by unikaly citlivé informace o kódu).
DEBUG = True

ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "catalog",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# SQLite = jednosouborová databáze, ideální pro lokální vývoj - žádný
# databázový server se nemusí instalovat ani spouštět zvlášť.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Europe/Prague"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
