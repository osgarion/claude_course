"""ProductVariant.price fallback: pure logic, no DB (unsaved instances only)."""
from decimal import Decimal

from catalog.models import Product, ProductVariant


def test_variant_without_override_uses_product_price():
    product = Product(name="Triko", price=Decimal("500.00"))
    variant = ProductVariant(product=product, price_override=None)
    assert variant.price == Decimal("500.00")


def test_variant_with_override_uses_own_price():
    product = Product(name="Triko", price=Decimal("500.00"))
    variant = ProductVariant(product=product, price_override=Decimal("450.00"))
    assert variant.price == Decimal("450.00")


def test_variant_override_zero_is_not_treated_as_falsy():
    """price_override=0 must win over product.price — only None means 'no override'."""
    product = Product(name="Triko", price=Decimal("500.00"))
    variant = ProductVariant(product=product, price_override=Decimal("0.00"))
    assert variant.price == Decimal("0.00")
