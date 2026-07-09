from rest_framework import serializers

from .models import Category, Product


class CategorySerializer(serializers.ModelSerializer):
    """Převádí Category objekty na JSON (a zpět) pro DRF endpointy."""

    class Meta:
        model = Category
        fields = ["id", "name", "slug"]


class ProductSerializer(serializers.ModelSerializer):
    """Převádí Product objekty na JSON (a zpět) pro DRF endpointy."""

    class Meta:
        model = Product
        fields = ["id", "name", "price", "description", "image_url", "stock"]
