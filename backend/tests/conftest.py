from decimal import Decimal

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from catalog.models import Address, Product


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def user(db):
    return User.objects.create_user("zakaznik", password="heslo123")


@pytest.fixture
def staff_user(db):
    return User.objects.create_user("owner", password="heslo123", is_staff=True)


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
