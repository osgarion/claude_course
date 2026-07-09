"""
ASGI config for the Pixel Pantry backend.

ASGI je novější, asynchronní obdoba WSGI - používá se u serverů, které
umí zpracovávat asynchronní požadavky (např. WebSockety). Pro náš
jednoduchý REST API zatím nevyužitá, ale Django ji generuje standardně.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_asgi_application()
