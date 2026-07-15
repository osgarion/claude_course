"""
Django settings for the Pixel Pantry backend.

Toto je hlavní konfigurační soubor projektu - Django ho čte při každém
startu a řídí se jím (jaké aplikace jsou zapnuté, jaká databáze se používá
atd.). Je to standardní soubor, jaký by vygeneroval `django-admin
startproject`, jen ručně upravený pro naše potřeby.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# BASE_DIR = cesta ke složce backend/ (o dvě úrovně nad tímto souborem)
BASE_DIR = Path(__file__).resolve().parent.parent

# Načte backend/.env, pokud existuje (lokální tajné klíče - Stripe,
# Sentry). Soubor je gitignored, viz backend/.env.example pro šablonu.
load_dotenv(BASE_DIR / ".env")

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
    "rest_framework.authtoken",
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
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Kam přesměrovat po přihlášení/odhlášení přes vestavěné auth views
# (django.contrib.auth.urls) - zpět na hlavní stránku obchodu.
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/"

# Vlastní User model (login e-mailem, žádné pole username) - musí být
# nastaveno před první migrací, proto se historie migrací v tomto
# projektu jednorázově resetovala při zavedení této změny.
AUTH_USER_MODEL = "catalog.User"

REST_FRAMEWORK = {
    # Frontend servírovaný přes Django dál používá SessionAuthentication
    # (cookie + CSRF token) - TokenAuthentication je navíc jen pro
    # budoucí API-only klienty, current frontend ji nepoužívá.
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.TokenAuthentication",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/min",
        "user": "120/min",
        # sdílený rozpočet pro login+register - ochrana proti brute-force
        "auth": "10/min",
        # každé volání chatbota stojí peníze (Anthropic API) - přísnější limit
        "chat": "20/min",
    },
}

# Platby (Stripe)
# Tajný klíč žije jen v backend/.env (gitignored), nikdy ne natvrdo tady.
# Bez klíče pay endpoint spadne zpět na okamžitou "fake" platbu.
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_CURRENCY = os.environ.get("STRIPE_CURRENCY", "czk")

# Sledování chyb (Sentry) - DSN jen v backend/.env, prázdné = vypnuto.
SENTRY_DSN = os.environ.get("SENTRY_DSN", "")

# Zákaznický chatbot (Claude Haiku přes Anthropic API) - klíč jen v
# backend/.env, nikdy ne natvrdo tady. Bez klíče /api/chat/ vrátí 503.
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

if "PYTEST_VERSION" in os.environ:
    # testy vždy běží proti fake platební bráně, bez reportování do Sentry
    # a bez reálného volání Anthropic API (chatbot testy Anthropic mockují)
    STRIPE_SECRET_KEY = ""
    STRIPE_WEBHOOK_SECRET = ""
    SENTRY_DSN = ""
    ANTHROPIC_API_KEY = ""

if SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment="development" if DEBUG else "production",
        traces_sample_rate=1.0,
    )
