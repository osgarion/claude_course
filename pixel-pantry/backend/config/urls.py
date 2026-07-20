"""
Hlavní routovací soubor projektu - určuje, která URL cesta vede do které
části aplikace. Detailní routy pro produkty jsou v catalog/urls.py,
sem je jen "napojujeme" pod prefix /api/.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic import TemplateView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("accounts/", include("django.contrib.auth.urls")),
    path("api/", include("catalog.urls")),
    path("", TemplateView.as_view(template_name="index.html"), name="index"),
    path(
        "produkt/<slug:slug>/",
        TemplateView.as_view(template_name="product_detail.html"),
        name="product-detail-page",
    ),
    path(
        "pokladna/",
        TemplateView.as_view(template_name="checkout.html"),
        name="checkout-page",
    ),
]

if settings.DEBUG:
    # V produkci by media soubory servíroval webserver (nginx apod.),
    # v devu je servíruje rovnou Django.
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
