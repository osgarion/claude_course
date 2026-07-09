"""Skladová kontrola: objednávka nesmí projít, pokud by přesáhla dostupný stock."""
import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def _order_payload(address, product, quantity):
    return {
        "shipping_address": address.id,
        "items": [{"product": product.id, "variant": None, "quantity": quantity}],
    }


def test_order_exceeding_stock_is_rejected(auth_client, make_address, make_product, user):
    address = make_address(user)
    product = make_product(name="Triko", price="500.00", stock=2)

    response = auth_client.post("/api/orders/", _order_payload(address, product, 5), format="json")

    assert response.status_code == 400
    product.refresh_from_db()
    assert product.stock == 2


def test_valid_order_decrements_stock(auth_client, make_address, make_product, user):
    address = make_address(user)
    product = make_product(name="Triko", price="500.00", stock=2)

    response = auth_client.post("/api/orders/", _order_payload(address, product, 2), format="json")

    assert response.status_code == 201
    product.refresh_from_db()
    assert product.stock == 0


def test_second_buyer_cannot_buy_already_sold_last_item(make_address, make_product, user, django_user_model):
    product = make_product(name="Poslední kus", price="100.00", stock=1)
    user_a = user
    user_b = django_user_model.objects.create_user("zakaznik_b", password="heslo123")
    address_a = make_address(user_a)
    address_b = make_address(user_b)

    client_a = APIClient()
    client_a.force_authenticate(user_a)
    client_b = APIClient()
    client_b.force_authenticate(user_b)

    first_response = client_a.post("/api/orders/", _order_payload(address_a, product, 1), format="json")
    second_response = client_b.post("/api/orders/", _order_payload(address_b, product, 1), format="json")

    assert first_response.status_code == 201
    assert second_response.status_code == 400
    product.refresh_from_db()
    assert product.stock == 0
