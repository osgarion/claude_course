"""
Hlavní routovací soubor projektu - určuje, která URL cesta vede do které
části aplikace. Detailní routy pro produkty jsou v catalog/urls.py,
sem je jen "napojujeme" pod prefix /api/.
"""

from django.contrib import admin
from django.urls import include, path
from django.views.generic import TemplateView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("catalog.urls")),
    path("", TemplateView.as_view(template_name="index.html"), name="index"),
]
