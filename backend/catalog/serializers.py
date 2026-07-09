from django.db import transaction
from rest_framework import serializers

from .models import (
    Address,
    Category,
    Order,
    OrderItem,
    Payment,
    Product,
    ProductImage,
    ProductVariant,
    Review,
)


class CategorySerializer(serializers.ModelSerializer):
    """Převádí Category objekty na JSON (a zpět) pro DRF endpointy."""

    class Meta:
        model = Category
        fields = ["id", "name", "slug"]


class ProductSerializer(serializers.ModelSerializer):
    """Převádí Product objekty na JSON (a zpět) pro DRF endpointy."""

    class Meta:
        model = Product
        fields = ["id", "name", "slug", "price", "description", "image_url", "stock"]


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

    user = serializers.ReadOnlyField(source="user.username")

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
    """Vytvoření objednávky včetně skladové kontroly a odečtu zásob."""

    items = OrderItemSerializer(many=True)

    class Meta:
        model = Order
        fields = ["id", "shipping_address", "status", "created_at", "items"]
        read_only_fields = ["status", "created_at"]

    def create(self, validated_data):
        items_data = validated_data.pop("items")
        if not items_data:
            raise serializers.ValidationError("Objednávka musí obsahovat aspoň jednu položku.")

        user = self.context["request"].user

        # transaction.atomic + select_for_update zamkne řádek produktu/varianty
        # na dobu transakce, takže dva souběžné požadavky na poslední kus se
        # nemůžou oba "vejít" - druhý počká, až první transakci dokončí
        # (commit nebo rollback), a uvidí už aktuální stock.
        with transaction.atomic():
            order = Order.objects.create(user=user, **validated_data)

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

        return order


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "order", "amount", "method", "status", "paid_at"]
        read_only_fields = ["status", "paid_at"]
