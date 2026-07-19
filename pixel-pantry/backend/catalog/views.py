import uuid

import stripe
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Avg, Count, Q
from django.utils import timezone
from rest_framework import permissions
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import (
    ListAPIView,
    ListCreateAPIView,
    RetrieveAPIView,
    RetrieveUpdateDestroyAPIView,
)
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework.authtoken.models import Token

from . import assistant, stripe_gateway
from .models import Address, Category, Coupon, Order, Payment, Product, Review
from .permissions import IsOwnerOfObject, IsOwnerOrReadOnly
from .serializers import (
    AddressSerializer,
    CategorySerializer,
    CouponCheckSerializer,
    LoginSerializer,
    OrderSerializer,
    PaymentSerializer,
    ProductDetailSerializer,
    ProductSerializer,
    RegisterSerializer,
    ReviewSerializer,
    UserSerializer,
)


def _rated_products_queryset():
    """Product queryset s anotovaným avg_rating/review_count (jen schválené recenze)."""
    approved = Q(reviews__is_approved=True)
    return Product.objects.filter(is_active=True).annotate(
        avg_rating=Avg("reviews__rating", filter=approved),
        review_count=Count("reviews", filter=approved),
    )


def _accessible_order(request, pk):
    """Objednávka dostupná buď přihlášenému vlastníkovi, nebo hostovi s platným tokenem.

    Vrací None, když objednávka neexistuje nebo k ní request nemá přístup
    - volající pak má vrátit 404 (ne 403), ať cizí/neexistující id vypadá stejně.
    """
    order = Order.objects.filter(pk=pk).first()
    if order is None:
        return None
    if request.user.is_authenticated:
        return order if order.user_id == request.user.id else None
    token = request.query_params.get("token") or request.headers.get("X-Guest-Token")
    if order.user_id is None and order.guest_token and token == str(order.guest_token):
        return order
    return None


class RegisterAPIView(APIView):
    """POST /api/auth/register/ - e-mail + heslo -> token (auto-login)."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        token, _ = Token.objects.get_or_create(user=user)
        return Response(
            {"token": token.key, "user": UserSerializer(user).data}, status=201
        )


class LoginAPIView(APIView):
    """POST /api/auth/login/ - e-mail + heslo -> token."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]
        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": UserSerializer(user).data})


class LogoutAPIView(APIView):
    """POST /api/auth/logout/ - smaže token přihlášeného uživatele."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        request.user.auth_token.delete()
        return Response(status=204)


class MeAPIView(APIView):
    """GET /api/auth/me/ - údaje o přihlášeném uživateli."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class CouponValidateAPIView(APIView):
    """POST /api/coupons/validate/ - {code} -> detaily kupónu, nebo 404."""

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        code = (request.data.get("code") or "").strip()
        coupon = Coupon.objects.filter(code__iexact=code).first()
        if coupon is None or not coupon.is_valid_now():
            return Response({"detail": "Neplatný nebo expirovaný kód."}, status=404)
        return Response(CouponCheckSerializer(coupon).data)


class ChatAPIView(APIView):
    """POST /api/chat/ - zákaznický chatbot (Claude Haiku).

    Funguje i pro anonymní návštěvníky (obecné dotazy), ale nástroje pro
    objednávky/adresy dostane model jen pokud je request.user přihlášený
    - viz assistant.build_tools a bezpečnostní poznámka v assistant.py.
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "chat"

    def post(self, request):
        if not settings.ANTHROPIC_API_KEY:
            return Response({"detail": "Chatbot není nakonfigurovaný."}, status=503)

        message = (request.data.get("message") or "").strip()
        if not message:
            return Response({"detail": "message je povinné."}, status=400)

        history = request.data.get("history") or []
        if not isinstance(history, list):
            return Response({"detail": "history musí být pole."}, status=400)
        clean_history = [
            {"role": h.get("role"), "content": h.get("content")}
            for h in history
            if isinstance(h, dict) and h.get("role") in ("user", "assistant") and h.get("content")
        ]

        reply, updated_history = assistant.run_chat(request, clean_history, message)
        return Response({"reply": reply, "history": updated_history})


class ProductListAPIView(ListAPIView):
    """GET /api/products/ - jen čtení, žádné vytváření/úpravy/mazání."""

    queryset = _rated_products_queryset()
    serializer_class = ProductSerializer


class ProductDetailAPIView(RetrieveAPIView):
    """GET /api/products/<slug>/ - detail produktu s obrázky, variantami a recenzemi."""

    queryset = _rated_products_queryset()
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


def _mark_paid(order, provider, transaction_id, method=Payment.METHOD_CARD):
    """Idempotentně zaeviduje platbu a přepne objednávku na paid."""
    with transaction.atomic():
        payment, _ = Payment.objects.get_or_create(
            order=order,
            defaults={
                "amount": order.total,
                "method": method,
                "provider": provider,
                "transaction_id": transaction_id,
            },
        )
        if payment.status != Payment.STATUS_COMPLETED:
            payment.status = Payment.STATUS_COMPLETED
            payment.provider = provider
            payment.transaction_id = transaction_id
            payment.paid_at = timezone.now()
            payment.save()
        if order.status == Order.STATUS_PENDING:
            order.status = Order.STATUS_PAID
            order.save(update_fields=["status", "updated_at"])
    return payment


class OrderListCreateAPIView(ListCreateAPIView):
    """GET /api/orders/ - jen vlastní objednávky přihlášeného uživatele.

    POST /api/orders/ - i pro anonymní zákazníky (guest checkout), viz
    OrderSerializer.create() a guest_token.
    Skladová kontrola a odečet zásob probíhá v OrderSerializer.create().
    """

    serializer_class = OrderSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        return Order.objects.filter(user=self.request.user)


class OrderDetailAPIView(RetrieveAPIView):
    """GET /api/orders/<pk>/ - vlastník objednávky, nebo host s platným guest_token."""

    serializer_class = OrderSerializer
    permission_classes = [permissions.AllowAny]

    def get_object(self):
        order = _accessible_order(self.request, self.kwargs["pk"])
        if order is None:
            raise NotFound()
        return order


class OrderPayAPIView(APIView):
    """POST /api/orders/<pk>/pay/ - zaplacení objednávky.

    Bez nastaveného Stripe klíče (settings.STRIPE_SECRET_KEY) rovnou
    simuluje okamžitě úspěšnou platbu. Se Stripe klíčem založí/vrátí
    PaymentIntent a čeká na potvrzení přes confirm_payment/webhook.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        order = _accessible_order(request, pk)
        if order is None:
            return Response(status=404)
        if order.status != Order.STATUS_PENDING:
            return Response(
                {"detail": f"objednávku ve stavu {order.status} nelze zaplatit."},
                status=400,
            )

        if not settings.STRIPE_SECRET_KEY:
            payment = _mark_paid(
                order,
                "fake",
                uuid.uuid4().hex,
                request.data.get("method", Payment.METHOD_CARD),
            )
            return Response(PaymentSerializer(payment).data)

        intent = stripe_gateway.payment_intent_for(order)
        return Response(
            {
                "provider": "stripe",
                "client_secret": intent.client_secret,
                "publishable_key": settings.STRIPE_PUBLISHABLE_KEY,
            }
        )


class OrderConfirmPaymentAPIView(APIView):
    """POST /api/orders/<pk>/confirm_payment/ - synchronní záloha k webhooku.

    Frontend po potvrzení platby na Stripe straně zavolá tenhle endpoint,
    aby se stav objednávky projevil hned (webhook může dorazit později).
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        order = _accessible_order(request, pk)
        if order is None:
            return Response(status=404)
        if order.status == Order.STATUS_PAID:
            return Response(OrderSerializer(order, context={"request": request}).data)
        if order.status != Order.STATUS_PENDING or not order.payment_intent_id:
            return Response({"detail": "není co potvrzovat."}, status=400)

        intent = stripe_gateway.retrieve_intent(order.payment_intent_id)
        if intent.status != "succeeded":
            return Response(
                {"detail": f"platba není dokončená ({intent.status})."}, status=400
            )
        _mark_paid(order, "stripe", intent.id)
        return Response(OrderSerializer(order, context={"request": request}).data)


class OrderCancelAPIView(APIView):
    """POST /api/orders/<pk>/cancel/ - zruší objednávku a vrátí zásoby na sklad."""

    permission_classes = [permissions.AllowAny]

    def post(self, request, pk):
        order = _accessible_order(request, pk)
        if order is None:
            return Response(status=404)
        if order.status not in (Order.STATUS_PENDING, Order.STATUS_PAID):
            return Response(
                {"detail": f"objednávku ve stavu {order.status} nelze zrušit."},
                status=400,
            )
        with transaction.atomic():
            order.cancel()
        return Response(OrderSerializer(order, context={"request": request}).data)


class StripeWebhookView(APIView):
    """Stripe sem posílá eventy; jediná autentizace je ověření podpisu."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = []

    def post(self, request):
        if not settings.STRIPE_WEBHOOK_SECRET:
            return Response({"detail": "webhook secret není nastaven."}, status=503)
        try:
            event = stripe.Webhook.construct_event(
                request.body,
                request.headers.get("Stripe-Signature", ""),
                settings.STRIPE_WEBHOOK_SECRET,
            )
        except (ValueError, stripe.SignatureVerificationError):
            return Response({"detail": "neplatný podpis."}, status=400)

        if event["type"] == "payment_intent.succeeded":
            intent = event["data"]["object"]
            order_id = (intent.get("metadata") or {}).get("order_id")
            try:
                order = Order.objects.filter(pk=order_id).first()
            except (DjangoValidationError, ValueError):
                order = None
            if order is not None:
                _mark_paid(order, "stripe", intent["id"])
        return Response({"received": True})


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
