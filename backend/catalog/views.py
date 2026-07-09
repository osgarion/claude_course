from django.utils import timezone
from rest_framework import permissions
from rest_framework.exceptions import ValidationError
from rest_framework.generics import (
    ListAPIView,
    ListCreateAPIView,
    RetrieveAPIView,
    RetrieveUpdateDestroyAPIView,
)
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Address, Category, Order, Payment, Product, Review
from .permissions import IsOwnerOfObject, IsOwnerOrReadOnly
from .serializers import (
    AddressSerializer,
    CategorySerializer,
    OrderSerializer,
    PaymentSerializer,
    ProductDetailSerializer,
    ProductSerializer,
    ReviewSerializer,
)


class ProductListAPIView(ListAPIView):
    """GET /api/products/ - jen čtení, žádné vytváření/úpravy/mazání."""

    queryset = Product.objects.filter(is_active=True)
    serializer_class = ProductSerializer


class ProductDetailAPIView(RetrieveAPIView):
    """GET /api/products/<slug>/ - detail produktu s obrázky, variantami a recenzemi."""

    queryset = Product.objects.filter(is_active=True)
    serializer_class = ProductDetailSerializer
    lookup_field = "slug"


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


class AddressListCreateAPIView(ListCreateAPIView):
    """GET/POST /api/addresses/ - jen vlastní adresy přihlášeného uživatele."""

    serializer_class = AddressSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Address.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class AddressDetailAPIView(RetrieveUpdateDestroyAPIView):
    """GET/PUT/PATCH/DELETE /api/addresses/<pk>/ - jen vlastník adresy.

    get_queryset i tak omezujeme na vlastní adresy (ne jen IsOwnerOfObject),
    aby cizí adresa vrátila 404 místo 403 - jinak by rozdíl v odpovědi
    prozradil, že záznam s daným ID vůbec existuje.
    """

    serializer_class = AddressSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOfObject]

    def get_queryset(self):
        return Address.objects.filter(user=self.request.user)


class OrderListCreateAPIView(ListCreateAPIView):
    """GET/POST /api/orders/ - jen vlastní objednávky přihlášeného uživatele.

    Skladová kontrola a odečet zásob probíhá v OrderSerializer.create().
    """

    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Order.objects.filter(user=self.request.user)


class OrderDetailAPIView(RetrieveAPIView):
    """GET /api/orders/<pk>/ - jen vlastník objednávky (viz pozn. u AddressDetailAPIView)."""

    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOfObject]

    def get_queryset(self):
        return Order.objects.filter(user=self.request.user)


class OrderPayAPIView(APIView):
    """POST /api/orders/<pk>/pay/ - simuluje zaplacení objednávky (bez reálné platební brány)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        order = Order.objects.filter(pk=pk, user=request.user).first()
        if order is None:
            return Response(status=404)

        amount = sum(item.unit_price * item.quantity for item in order.items.all())
        payment, _ = Payment.objects.get_or_create(
            order=order,
            defaults={
                "amount": amount,
                "method": request.data.get("method", Payment.METHOD_CARD),
            },
        )
        payment.status = Payment.STATUS_COMPLETED
        payment.paid_at = timezone.now()
        payment.save()

        order.status = Order.STATUS_PAID
        order.save()

        return Response(PaymentSerializer(payment).data)


class ReviewListCreateAPIView(ListCreateAPIView):
    """GET/POST /api/products/<product_pk>/reviews/

    Čtení veřejné (jen schválené recenze, staff vidí i neschválené),
    vytvoření jen pro přihlášené - nová recenze čeká na schválení ownerem.
    """

    serializer_class = ReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        qs = Review.objects.filter(product_id=self.kwargs["product_pk"])
        if not (self.request.user.is_authenticated and self.request.user.is_staff):
            qs = qs.filter(is_approved=True)
        return qs

    def perform_create(self, serializer):
        product_id = self.kwargs["product_pk"]
        # Meta.unique_together se u ModelSerializeru nevaliduje automaticky,
        # protože product/user nejsou zapisovatelná pole tohoto serializeru
        # (product jde z URL, user z requestu) - kontrolujeme ručně, ať
        # dostaneme čistou 400 místo IntegrityError z databáze.
        if Review.objects.filter(product_id=product_id, user=self.request.user).exists():
            raise ValidationError("Tento produkt už jsi recenzoval/a.")
        serializer.save(user=self.request.user, product_id=product_id)
