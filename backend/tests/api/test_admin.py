"""Smoke test: každá registrovaná admin stránka se musí bez pádu vykreslit.

Iteruje nad admin.site._registry, takže nový model registrovaný v adminu
je automaticky pokrytý bez ruční údržby seznamu.
"""
from decimal import Decimal

import pytest
from django.contrib import admin
from django.test import Client
from django.urls import reverse

from catalog.models import (
    Address,
    Category,
    Coupon,
    Order,
    Payment,
    Product,
    Review,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client_(staff_user, make_address, make_product):
    staff_user.is_superuser = True
    staff_user.save()
    client = Client()
    client.force_login(staff_user)

    category = Category.objects.create(name="Admin kategorie")
    product = make_product(name="Admin produkt", category=category)
    address = make_address(staff_user)
    order = Order.objects.create(
        user=staff_user,
        shipping_address=address,
        subtotal=Decimal("100.00"),
        total=Decimal("100.00"),
    )
    Payment.objects.create(order=order, amount=Decimal("100.00"), method=Payment.METHOD_CARD)
    Review.objects.create(product=product, user=staff_user, rating=5)
    Coupon.objects.create(code="ADMINTEST", discount_type=Coupon.DISCOUNT_PERCENT, value=Decimal("5"))
    return client


def test_admin_login_page_renders():
    response = Client().get(reverse("admin:login"))
    assert response.status_code == 200


def test_admin_index_renders(admin_client_):
    response = admin_client_.get(reverse("admin:index"))
    assert response.status_code == 200


@pytest.mark.parametrize("model", list(admin.site._registry.keys()))
def test_admin_changelist_renders(admin_client_, model):
    opts = model._meta
    url = reverse(f"admin:{opts.app_label}_{opts.model_name}_changelist")
    response = admin_client_.get(url)
    assert response.status_code == 200


@pytest.mark.parametrize("model", list(admin.site._registry.keys()))
def test_admin_add_page_renders(admin_client_, model):
    opts = model._meta
    url = reverse(f"admin:{opts.app_label}_{opts.model_name}_add")
    response = admin_client_.get(url)
    assert response.status_code == 200
