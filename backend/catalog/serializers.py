import uuid

from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers

from .models import (
    Address,
    Category,
    Coupon,
    Order,
    OrderItem,
    Payment,
    Product,
    ProductImage,
    ProductVariant,
    Review,
    User,
)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name"]


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("Tento e-mail už je zaregistrovaný.")
        return value

    def validate_password(self, value):
        validate_password(value)
        return value

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        user = authenticate(
            request=self.context.get("request"),
            username=attrs["email"],
            password=attrs["password"],
        )
        if user is None:
            raise serializers.ValidationError("Nesprávný e-mail nebo heslo.")
        attrs["user"] = user
        return attrs


class CouponCheckSerializer(serializers.ModelSerializer):
    class Meta:
        model = Coupon
        fields = ["code", "discount_type", "value"]


class CategorySerializer(serializers.ModelSerializer):
    """Převádí Category objekty na JSON (a zpět) pro DRF endpointy."""

    class Meta:
        model = Category
        fields = ["id", "name", "slug"]


class ProductSerializer(serializers.ModelSerializer):
    """Převádí Product objekty na JSON (a zpět) pro DRF endpointy."""

    # Naplněno anotací (Avg/Count) v queryset view - jen u schválených recenzí.
    avg_rating = serializers.FloatField(read_only=True, allow_null=True)
    review_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Product
        fields = [
            "id",
            "name",
            "slug",
            "price",
            "description",
            "image_url",
            "stock",
            "avg_rating",
            "review_count",
        ]


class ProductImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductImage
        fields = ["id", "image", "alt_text", "is_primary"]


class ProductVariantSerializer(serializers.ModelSerializer):
    price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = ProductVariant
        fields = ["id", "name", "sku", "price", "stock"]


class ReviewSerializer(serializers.ModelSerializer):
    """Recenze produktu - user se dosazuje z requestu, is_approved nastaví jen owner v adminu."""

    user = serializers.ReadOnlyField(source="user.email")

    class Meta:
        model = Review
        fields = ["id", "user", "rating", "comment", "is_approved", "created_at"]
        read_only_fields = ["is_approved", "created_at"]


class ProductDetailSerializer(serializers.ModelSerializer):
    """Detail produktu včetně obrázků, variant a schválených recenzí."""

    category = CategorySerializer(read_only=True)
    images = ProductImageSerializer(many=True, read_only=True)
    variants = ProductVariantSerializer(many=True, read_only=True)
    reviews = serializers.SerializerMethodField()
    avg_rating = serializers.FloatField(read_only=True, allow_null=True)
    review_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Product
        fields = [
            "id",
            "name",
            "slug",
            "category",
            "price",
            "description",
            "image_url",
            "stock",
            "images",
            "variants",
            "reviews",
            "avg_rating",
            "review_count",
        ]

    def get_reviews(self, obj):
        approved = obj.reviews.filter(is_approved=True)
        return ReviewSerializer(approved, many=True).data


class AddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = Address
        fields = [
            "id",
            "full_name",
            "street",
            "city",
            "postal_code",
            "country",
            "phone",
            "is_default",
        ]


class OrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = OrderItem
        fields = ["id", "product", "variant", "quantity", "unit_price"]
        read_only_fields = ["unit_price"]


class OrderSerializer(serializers.ModelSerializer):
    """Vytvoření objednávky včetně skladové kontroly, odečtu zásob a slevy.

    Objednávku smí vytvořit i anonymní zákazník (guest checkout) - pak
    buď pošle vlastní adresu přes shipping_address_input (založí se nová
    Address bez uživatele), nebo (přihlášený) referencuje existující
    shipping_address. guest_token se vrátí jen jednou, v odpovědi na
    create - host jím prokazuje přístup ke své objednávce (viz views.py).
    """

    items = OrderItemSerializer(many=True)
    shipping_address = serializers.PrimaryKeyRelatedField(
        queryset=Address.objects.all(), required=False
    )
    shipping_address_input = AddressSerializer(write_only=True, required=False)
    coupon_code = serializers.CharField(write_only=True, required=False, allow_blank=True)
    coupon = serializers.SlugRelatedField(slug_field="code", read_only=True)

    class Meta:
        model = Order
        fields = [
            "id",
            "shipping_address",
            "shipping_address_input",
            "status",
            "coupon_code",
            "coupon",
            "subtotal",
            "discount_amount",
            "total",
            "guest_token",
            "created_at",
            "items",
        ]
        read_only_fields = [
            "status",
            "coupon",
            "subtotal",
            "discount_amount",
            "total",
            "guest_token",
            "created_at",
        ]

    def validate(self, attrs):
        has_existing = "shipping_address" in attrs
        has_inline = "shipping_address_input" in attrs
        if has_existing == has_inline:
            raise serializers.ValidationError(
                "Zadej buď shipping_address (existující adresu), nebo "
                "shipping_address_input (novou adresu), ne obojí ani nic."
            )

        request = self.context["request"]
        if has_existing and request.user.is_authenticated:
            if attrs["shipping_address"].user_id != request.user.id:
                raise serializers.ValidationError({"shipping_address": "Adresa nenalezena."})

        coupon_code = attrs.get("coupon_code")
        if coupon_code:
            coupon = Coupon.objects.filter(code__iexact=coupon_code).first()
            if coupon is None or not coupon.is_valid_now():
                raise serializers.ValidationError(
                    {"coupon_code": "Neplatný nebo expirovaný slevový kód."}
                )
            attrs["coupon"] = coupon

        if not attrs.get("items"):
            raise serializers.ValidationError("Objednávka musí obsahovat aspoň jednu položku.")
        return attrs

    def create(self, validated_data):
        items_data = validated_data.pop("items")
        address_input = validated_data.pop("shipping_address_input", None)
        validated_data.pop("coupon_code", None)
        coupon = validated_data.pop("coupon", None)

        request = self.context["request"]
        user = request.user if request.user.is_authenticated else None

        # transaction.atomic + select_for_update zamkne řádek produktu/varianty
        # na dobu transakce, takže dva souběžné požadavky na poslední kus se
        # nemůžou oba "vejít" - druhý počká, až první transakci dokončí
        # (commit nebo rollback), a uvidí už aktuální stock.
        with transaction.atomic():
            if address_input is not None:
                shipping_address = Address.objects.create(user=user, **address_input)
            else:
                shipping_address = validated_data.pop("shipping_address")

            order = Order.objects.create(
                user=user,
                shipping_address=shipping_address,
                coupon=coupon,
                guest_token=uuid.uuid4() if user is None else None,
                subtotal=0,
                total=0,
            )

            subtotal = 0
            for item_data in items_data:
                variant = item_data.get("variant")
                stocked_model = ProductVariant if variant else Product
                target_pk = variant.pk if variant else item_data["product"].pk
                locked = stocked_model.objects.select_for_update().get(pk=target_pk)

                if locked.stock < item_data["quantity"]:
                    raise serializers.ValidationError(
                        f"Nedostatek skladem pro '{locked}': "
                        f"dostupno {locked.stock}, požadováno {item_data['quantity']}."
                    )

                locked.stock -= item_data["quantity"]
                locked.save()

                OrderItem.objects.create(
                    order=order,
                    product=item_data["product"],
                    variant=variant,
                    quantity=item_data["quantity"],
                    unit_price=locked.price,
                )
                subtotal += locked.price * item_data["quantity"]

            discount_amount = coupon.discount_for(subtotal) if coupon else 0
            order.subtotal = subtotal
            order.discount_amount = discount_amount
            order.total = subtotal - discount_amount
            order.save(update_fields=["subtotal", "discount_amount", "total"])

        return order


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = [
            "id",
            "order",
            "amount",
            "method",
            "status",
            "provider",
            "transaction_id",
            "paid_at",
        ]
        read_only_fields = ["status", "provider", "transaction_id", "paid_at"]
