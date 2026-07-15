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


def test_order_with_coupon_computes_totals(auth_client, make_address, make_product, make_coupon, user):
    address = make_address(user)
    product = make_product(name="Triko", price="200.00", stock=5)
    coupon = make_coupon(code="SLEVA10", discount_type="percent", value="10")

    payload = _order_payload(address, product, 2)
    payload["coupon_code"] = coupon.code
    response = auth_client.post("/api/orders/", payload, format="json")

    assert response.status_code == 201
    assert response.data["subtotal"] == "400.00"
    assert response.data["discount_amount"] == "40.00"
    assert response.data["total"] == "360.00"


def test_order_with_variant_and_coupon_uses_variant_price(
    auth_client, make_address, make_product, make_coupon, user
):
    from catalog.models import ProductVariant

    address = make_address(user)
    product = make_product(name="Triko", price="200.00", stock=5)
    variant = ProductVariant.objects.create(
        product=product, name="XL", sku="TRIKO-XL", price_override="250.00", stock=5
    )
    coupon = make_coupon(code="SLEVA10", discount_type="percent", value="10")

    response = auth_client.post(
        "/api/orders/",
        {
            "shipping_address": address.id,
            "coupon_code": coupon.code,
            "items": [{"product": product.id, "variant": variant.id, "quantity": 2}],
        },
        format="json",
    )

    assert response.status_code == 201
    assert response.data["subtotal"] == "500.00"
    assert response.data["discount_amount"] == "50.00"
    assert response.data["total"] == "450.00"


def test_invalid_coupon_code_rejected(auth_client, make_address, make_product, user):
    address = make_address(user)
    product = make_product(name="Triko", price="200.00", stock=5)

    payload = _order_payload(address, product, 1)
    payload["coupon_code"] = "NEEXISTUJE"
    response = auth_client.post("/api/orders/", payload, format="json")

    assert response.status_code == 400


def test_cancel_restores_stock(auth_client, make_address, make_product, user):
    address = make_address(user)
    product = make_product(name="Triko", price="200.00", stock=5)

    create_response = auth_client.post(
        "/api/orders/", _order_payload(address, product, 2), format="json"
    )
    order_id = create_response.data["id"]
    product.refresh_from_db()
    assert product.stock == 3

    cancel_response = auth_client.post(f"/api/orders/{order_id}/cancel/")

    assert cancel_response.status_code == 200
    assert cancel_response.data["status"] == "cancelled"
    product.refresh_from_db()
    assert product.stock == 5


def test_cancel_twice_is_rejected(auth_client, make_address, make_product, user):
    address = make_address(user)
    product = make_product(name="Triko", price="200.00", stock=5)

    create_response = auth_client.post(
        "/api/orders/", _order_payload(address, product, 1), format="json"
    )
    order_id = create_response.data["id"]
    auth_client.post(f"/api/orders/{order_id}/cancel/")

    second_cancel = auth_client.post(f"/api/orders/{order_id}/cancel/")
    assert second_cancel.status_code == 400


def test_second_buyer_cannot_buy_already_sold_last_item(make_address, make_product, user, django_user_model):
    product = make_product(name="Poslední kus", price="100.00", stock=1)
    user_a = user
    user_b = django_user_model.objects.create_user(email="zakaznik_b@example.com", password="heslo123")
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
