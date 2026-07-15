"""Nástroje chatbota berou identitu jen z request.user, nikdy od modelu -
tenhle soubor ověřuje, že cizí objednávku/adresu nejde přes ně obejít."""
from types import SimpleNamespace

import pytest

from catalog.assistant import (
    _cancel_my_order,
    _create_order,
    _get_order_status,
    _list_my_addresses,
    _list_my_orders,
)
from catalog.models import Order

pytestmark = pytest.mark.django_db


def _request_for(user):
    return SimpleNamespace(user=user)


def test_get_order_status_requires_authentication():
    from django.contrib.auth.models import AnonymousUser

    result = _get_order_status(_request_for(AnonymousUser()), order_id=1)
    assert result == {"error": "not_authenticated"}


def test_get_order_status_cannot_access_other_users_order(user, django_user_model, make_address):
    other = django_user_model.objects.create_user(email="jiny@example.com", password="heslo123")
    address = make_address(other)
    order = Order.objects.create(
        user=other, shipping_address=address, subtotal="100.00", total="100.00"
    )

    result = _get_order_status(_request_for(user), order_id=order.id)

    assert result == {"error": "not_found"}


def test_get_order_status_returns_own_order(user, make_address):
    address = make_address(user)
    order = Order.objects.create(
        user=user, shipping_address=address, subtotal="100.00", total="100.00"
    )

    result = _get_order_status(_request_for(user), order_id=order.id)

    assert result["id"] == order.id


def test_cancel_my_order_cannot_cancel_other_users_order(user, django_user_model, make_address):
    other = django_user_model.objects.create_user(email="jiny@example.com", password="heslo123")
    address = make_address(other)
    order = Order.objects.create(
        user=other, shipping_address=address, status=Order.STATUS_PENDING,
        subtotal="100.00", total="100.00",
    )

    result = _cancel_my_order(_request_for(user), order_id=order.id)

    assert result == {"error": "not_found"}
    order.refresh_from_db()
    assert order.status == Order.STATUS_PENDING


def test_create_order_rejects_other_users_shipping_address(user, django_user_model, make_address, make_product):
    other = django_user_model.objects.create_user(email="jiny@example.com", password="heslo123")
    other_address = make_address(other)
    product = make_product(stock=5)

    result = _create_order(
        _request_for(user),
        items=[{"product_id": product.id, "quantity": 1}],
        shipping_address_id=other_address.id,
    )

    assert result["error"] == "validation_failed"
    assert Order.objects.filter(user=user).count() == 0


def test_create_order_creates_order_for_request_user_only(user, make_address, make_product):
    address = make_address(user)
    product = make_product(stock=5)

    result = _create_order(
        _request_for(user),
        items=[{"product_id": product.id, "quantity": 2}],
        shipping_address_id=address.id,
    )

    assert "order_id" in result
    order = Order.objects.get(pk=result["order_id"])
    assert order.user_id == user.id


def test_list_my_orders_and_addresses_require_authentication():
    from django.contrib.auth.models import AnonymousUser

    request = _request_for(AnonymousUser())
    assert _list_my_orders(request) == {"error": "not_authenticated"}
    assert _list_my_addresses(request) == {"error": "not_authenticated"}


def test_list_my_orders_only_returns_own_orders(user, django_user_model, make_address):
    other = django_user_model.objects.create_user(email="jiny@example.com", password="heslo123")
    make_address(user)
    address_other = make_address(other)
    Order.objects.create(
        user=other, shipping_address=address_other, subtotal="50.00", total="50.00"
    )

    result = _list_my_orders(_request_for(user))

    assert result == []
