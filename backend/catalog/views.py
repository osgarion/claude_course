from rest_framework.generics import (
    ListAPIView,
    ListCreateAPIView,
    RetrieveUpdateDestroyAPIView,
)

from .models import Category, Product
from .permissions import IsOwnerOrReadOnly
from .serializers import CategorySerializer, ProductSerializer


class ProductListAPIView(ListAPIView):
    """GET /api/products/ - jen čtení, žádné vytváření/úpravy/mazání."""

    queryset = Product.objects.all()
    serializer_class = ProductSerializer


class CategoryListCreateAPIView(ListCreateAPIView):
    """GET /api/categories/ - veřejné čtení, POST jen pro ownera (is_staff)."""

    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [IsOwnerOrReadOnly]


class CategoryDetailAPIView(RetrieveUpdateDestroyAPIView):
    """GET/PUT/PATCH/DELETE /api/categories/<pk>/ - detail veřejný, zápis jen owner."""

    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [IsOwnerOrReadOnly]
