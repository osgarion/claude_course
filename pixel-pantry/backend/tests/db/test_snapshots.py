"""Cenový snapshot objednávky nesmí ovlivnit pozdější editace kupónu."""
from decimal import Decimal

import pytest

from catalog.models import Order

pytestmark = pytest.mark.django_db


def test_coupon_discount_is_frozen_after_coupon_edit(auth_client, make_address, make_product, make_coupon, user):
    address = make_address(user)
    product = make_product(name="Triko", price="200.00", stock=5)
    coupon = make_coupon(code="SLEVA10", discount_type="percent", value="10")

    response = auth_client.post(
        "/api/orders/",
        {
            "shipping_address": address.id,
            "coupon_code": coupon.code,
            "items": [{"product": product.id, "quantity": 1}],
        },
        format="json",
    )
    order_id = response.data["id"]
    assert response.data["discount_amount"] == "20.00"

    # sleva se dodatečně zvýší - stará objednávka musí zůstat u původní hodnoty
    coupon.value = Decimal("50")
    coupon.save()

    order = Order.objects.get(pk=order_id)
    assert order.discount_amount == Decimal("20.00")
    assert order.total == Decimal("180.00")


def test_order_item_unit_price_is_frozen_after_product_price_change(
    auth_client, make_address, make_product, user
):
    address = make_address(user)
    product = make_product(name="Triko", price="200.00", stock=5)

    response = auth_client.post(
        "/api/orders/",
        {"shipping_address": address.id, "items": [{"product": product.id, "quantity": 1}]},
        format="json",
    )
    order_id = response.data["id"]

    product.price = Decimal("999.00")
    product.save()

    order = Order.objects.get(pk=order_id)
    item = order.items.first()
    assert item.unit_price == Decimal("200.00")
