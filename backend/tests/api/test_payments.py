"""Pay/confirm_payment/webhook. Stripe je vždy mockovaný - žádné reálné volání
Stripe API v testech, i když .env obsahuje reálné test-mode klíče."""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.test import override_settings

from catalog.models import Order, Payment

pytestmark = pytest.mark.django_db


def _order_payload(address, product):
    return {
        "shipping_address": address.id,
        "items": [{"product": product.id, "quantity": 1}],
    }


def _create_order(auth_client, address, product):
    response = auth_client.post("/api/orders/", _order_payload(address, product), format="json")
    assert response.status_code == 201
    return response.data["id"]


def test_pay_without_stripe_key_uses_fake_provider(auth_client, make_address, make_product, user):
    address = make_address(user)
    product = make_product(stock=5)
    order_id = _create_order(auth_client, address, product)

    with override_settings(STRIPE_SECRET_KEY=""):
        response = auth_client.post(f"/api/orders/{order_id}/pay/")

    assert response.status_code == 200
    assert response.data["status"] == Payment.STATUS_COMPLETED
    order = Order.objects.get(pk=order_id)
    assert order.status == Order.STATUS_PAID


def test_pay_with_stripe_key_returns_client_secret(auth_client, make_address, make_product, user):
    address = make_address(user)
    product = make_product(stock=5)
    order_id = _create_order(auth_client, address, product)

    fake_intent = SimpleNamespace(id="pi_123", client_secret="secret_123", status="requires_payment_method")
    with override_settings(STRIPE_SECRET_KEY="sk_test_fake", STRIPE_PUBLISHABLE_KEY="pk_test_fake"):
        with patch("stripe.PaymentIntent.create", return_value=fake_intent):
            response = auth_client.post(f"/api/orders/{order_id}/pay/")

    assert response.status_code == 200
    assert response.data["provider"] == "stripe"
    assert response.data["client_secret"] == "secret_123"
    order = Order.objects.get(pk=order_id)
    assert order.status == Order.STATUS_PENDING
    assert order.payment_intent_id == "pi_123"


def test_confirm_payment_marks_order_paid(auth_client, make_address, make_product, user):
    address = make_address(user)
    product = make_product(stock=5)
    order_id = _create_order(auth_client, address, product)

    fake_intent = SimpleNamespace(id="pi_123", client_secret="secret_123", status="requires_payment_method")
    with override_settings(STRIPE_SECRET_KEY="sk_test_fake"):
        with patch("stripe.PaymentIntent.create", return_value=fake_intent):
            auth_client.post(f"/api/orders/{order_id}/pay/")

        succeeded_intent = SimpleNamespace(id="pi_123", status="succeeded")
        with patch("stripe.PaymentIntent.retrieve", return_value=succeeded_intent):
            response = auth_client.post(f"/api/orders/{order_id}/confirm_payment/")

    assert response.status_code == 200
    assert response.data["status"] == Order.STATUS_PAID
    assert Payment.objects.get(order_id=order_id).provider == "stripe"


def test_confirm_payment_rejects_unfinished_intent(auth_client, make_address, make_product, user):
    address = make_address(user)
    product = make_product(stock=5)
    order_id = _create_order(auth_client, address, product)

    fake_intent = SimpleNamespace(id="pi_123", client_secret="secret_123", status="requires_payment_method")
    with override_settings(STRIPE_SECRET_KEY="sk_test_fake"):
        with patch("stripe.PaymentIntent.create", return_value=fake_intent):
            auth_client.post(f"/api/orders/{order_id}/pay/")

        pending_intent = SimpleNamespace(id="pi_123", status="requires_payment_method")
        with patch("stripe.PaymentIntent.retrieve", return_value=pending_intent):
            response = auth_client.post(f"/api/orders/{order_id}/confirm_payment/")

    assert response.status_code == 400
    order = Order.objects.get(pk=order_id)
    assert order.status == Order.STATUS_PENDING


def test_webhook_without_secret_returns_503(api_client):
    with override_settings(STRIPE_WEBHOOK_SECRET=""):
        response = api_client.post("/api/stripe/webhook/", data=b"{}", content_type="application/json")
    assert response.status_code == 503


def test_webhook_rejects_bad_signature(api_client):
    with override_settings(STRIPE_WEBHOOK_SECRET="whsec_fake"):
        import stripe

        with patch("stripe.Webhook.construct_event", side_effect=stripe.SignatureVerificationError("bad", "sig")):
            response = api_client.post(
                "/api/stripe/webhook/", data=b"{}", content_type="application/json",
                HTTP_STRIPE_SIGNATURE="bad",
            )
    assert response.status_code == 400


def test_webhook_marks_order_paid(api_client, auth_client, make_address, make_product, user):
    address = make_address(user)
    product = make_product(stock=5)
    order_id = _create_order(auth_client, address, product)

    event = {
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": "pi_evt_1", "metadata": {"order_id": str(order_id)}}},
    }
    with override_settings(STRIPE_WEBHOOK_SECRET="whsec_fake"):
        with patch("stripe.Webhook.construct_event", return_value=event):
            response = api_client.post(
                "/api/stripe/webhook/", data=b"{}", content_type="application/json",
                HTTP_STRIPE_SIGNATURE="ok",
            )

    assert response.status_code == 200
    order = Order.objects.get(pk=order_id)
    assert order.status == Order.STATUS_PAID
    assert Payment.objects.get(order_id=order_id).transaction_id == "pi_evt_1"


def test_webhook_ignores_unknown_order(api_client):
    event = {
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": "pi_evt_2", "metadata": {"order_id": "999999"}}},
    }
    with override_settings(STRIPE_WEBHOOK_SECRET="whsec_fake"):
        with patch("stripe.Webhook.construct_event", return_value=event):
            response = api_client.post(
                "/api/stripe/webhook/", data=b"{}", content_type="application/json",
                HTTP_STRIPE_SIGNATURE="ok",
            )
    assert response.status_code == 200
