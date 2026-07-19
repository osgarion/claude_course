"""Plný request/response cyklus přes APIClient: routing, auth, permissions."""
import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def test_user_cannot_access_foreign_address(make_address, user, django_user_model):
    owner = user
    other = django_user_model.objects.create_user(email="uzivatel_b@example.com", password="heslo123")
    address = make_address(owner)

    client = APIClient()
    client.force_authenticate(other)
    response = client.get(f"/api/addresses/{address.id}/")

    assert response.status_code == 404


def test_only_staff_can_create_category(user, staff_user):
    client = APIClient()
    client.force_authenticate(user)
    response = client.post("/api/categories/", {"name": "Nová kategorie"}, format="json")
    assert response.status_code == 403

    client.force_authenticate(staff_user)
    response = client.post("/api/categories/", {"name": "Nová kategorie"}, format="json")
    assert response.status_code == 201


def _guest_order_payload(product):
    return {
        "shipping_address_input": {
            "full_name": "Host Zákazník",
            "street": "Ulice 1",
            "city": "Praha",
            "postal_code": "10000",
            "country": "Česko",
        },
        "items": [{"product": product.id, "quantity": 1}],
    }


def test_guest_can_create_order(api_client, make_product):
    product = make_product(stock=5)
    response = api_client.post("/api/orders/", _guest_order_payload(product), format="json")

    assert response.status_code == 201
    assert response.data["guest_token"] is not None


def test_guest_can_retrieve_own_order_with_token(api_client, make_product):
    product = make_product(stock=5)
    create_response = api_client.post("/api/orders/", _guest_order_payload(product), format="json")
    order_id = create_response.data["id"]
    token = create_response.data["guest_token"]

    response = api_client.get(f"/api/orders/{order_id}/?token={token}")
    assert response.status_code == 200


def test_guest_order_inaccessible_without_token(api_client, make_product):
    product = make_product(stock=5)
    create_response = api_client.post("/api/orders/", _guest_order_payload(product), format="json")
    order_id = create_response.data["id"]

    response = api_client.get(f"/api/orders/{order_id}/")
    assert response.status_code == 404


def test_guest_order_inaccessible_with_wrong_token(api_client, make_product):
    product = make_product(stock=5)
    create_response = api_client.post("/api/orders/", _guest_order_payload(product), format="json")
    order_id = create_response.data["id"]

    response = api_client.get(f"/api/orders/{order_id}/?token=00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


def test_anonymous_request_cannot_access_guest_order_via_none_equals_none(api_client, make_product):
    """Regrese: guest objednávka i anonymní request mají user_id=None -
    IsOwnerOfObject nesmí "None == None" vyhodnotit jako shodu vlastníka."""
    product = make_product(stock=5)
    create_response = api_client.post("/api/orders/", _guest_order_payload(product), format="json")
    order_id = create_response.data["id"]

    # bez tokenu a bez přihlášení - i když obj.user_id i request.user.id jsou None
    response = api_client.get(f"/api/orders/{order_id}/")
    assert response.status_code == 404


def test_authenticated_user_cannot_access_guest_order(auth_client, make_product):
    product = make_product(stock=5)
    client = APIClient()
    create_response = client.post("/api/orders/", _guest_order_payload(product), format="json")
    order_id = create_response.data["id"]

    response = auth_client.get(f"/api/orders/{order_id}/")
    assert response.status_code == 404
