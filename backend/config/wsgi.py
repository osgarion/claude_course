"""
WSGI config for the Pixel Pantry backend.

WSGI (Web Server Gateway Interface) je standardní rozhraní, přes které
tradiční webové servery (např. gunicorn) komunikují s Django aplikací
při nasazení do produkce.
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_wsgi_application()
