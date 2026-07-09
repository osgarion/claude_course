from rest_framework.generics import ListAPIView

from .models import Product
from .serializers import ProductSerializer


class ProductListAPIView(ListAPIView):
    """GET /api/products/ - jen čtení, žádné vytváření/úpravy/mazání."""

    queryset = Product.objects.all()
    serializer_class = ProductSerializer
