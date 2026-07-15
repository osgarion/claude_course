from decimal import Decimal

import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from catalog.models import Address, Coupon, Product, User


@pytest.fixture(autouse=True)
def _clear_throttle_cache():
    """Throttle counters žijí v cache - bez resetu by testy ovlivňovaly jeden druhý."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user(email="zakaznik@example.com", password="heslo123")


@pytest.fixture
def staff_user(db):
    return User.objects.create_user(email="owner@example.com", password="heslo123", is_staff=True)


@pytest.fixture
def auth_client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def make_address(db):
    def _make(user, **kwargs):
        defaults = dict(full_name="Jan Novák", street="Ulice 1", city="Praha",
                         postal_code="10000", country="Česko")
        defaults.update(kwargs)
        return Address.objects.create(user=user, **defaults)
    return _make


@pytest.fixture
def make_product(db):
    def _make(name="Produkt", price="100.00", stock=5, **kwargs):
        return Product.objects.create(name=name, price=Decimal(price), stock=stock, **kwargs)
    return _make


@pytest.fixture
def make_coupon(db):
    def _make(code="SLEVA10", discount_type=Coupon.DISCOUNT_PERCENT, value="10", **kwargs):
        return Coupon.objects.create(
            code=code, discount_type=discount_type, value=Decimal(value), **kwargs
        )
    return _make
