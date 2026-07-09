from rest_framework import serializers

from .models import Product


class ProductSerializer(serializers.ModelSerializer):
    """Převádí Product objekty na JSON (a zpět) pro DRF endpointy."""

    class Meta:
        model = Product
        fields = ["id", "name", "price", "description", "image_url", "stock"]
