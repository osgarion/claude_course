"""Product a Category si samy doplní slug ze jména, pokud není zadaný."""
from decimal import Decimal

import pytest

from catalog.models import Category, Product

pytestmark = pytest.mark.django_db


def test_product_slug_auto_generated():
    product = Product.objects.create(name="Pixel Hrnek", price=Decimal("299.00"))
    assert product.slug == "pixel-hrnek"


def test_category_slug_auto_generated():
    category = Category.objects.create(name="Hrnky a šálky")
    assert category.slug == "hrnky-a-salky"


def test_explicit_slug_is_not_overwritten():
    product = Product.objects.create(name="Pixel Hrnek", price=Decimal("299.00"), slug="vlastni-slug")
    assert product.slug == "vlastni-slug"
