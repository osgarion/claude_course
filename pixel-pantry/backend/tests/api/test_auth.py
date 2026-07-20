"""Token auth: register/login/logout/me a izolace dat mezi uživateli."""
import pytest
from rest_framework.authtoken.models import Token

pytestmark = pytest.mark.django_db


def test_register_returns_token(api_client):
    response = api_client.post(
        "/api/auth/register/",
        {"email": "novy@example.com", "password": "velmi-tajne-heslo-1"},
        format="json",
    )
    assert response.status_code == 201
    assert response.data["user"]["email"] == "novy@example.com"
    assert Token.objects.filter(key=response.data["token"]).exists()


def test_register_rejects_weak_password(api_client):
    response = api_client.post(
        "/api/auth/register/",
        {"email": "novy@example.com", "password": "123"},
        format="json",
    )
    assert response.status_code == 400


def test_register_rejects_duplicate_email(api_client, user):
    response = api_client.post(
        "/api/auth/register/",
        {"email": user.email, "password": "velmi-tajne-heslo-1"},
        format="json",
    )
    assert response.status_code == 400


def test_login_returns_token(api_client, user):
    response = api_client.post(
        "/api/auth/login/", {"email": user.email, "password": "heslo123"}, format="json"
    )
    assert response.status_code == 200
    assert "token" in response.data


def test_login_rejects_wrong_password(api_client, user):
    response = api_client.post(
        "/api/auth/login/", {"email": user.email, "password": "spatne"}, format="json"
    )
    assert response.status_code == 400


def test_me_requires_authentication(api_client):
    response = api_client.get("/api/auth/me/")
    assert response.status_code in (401, 403)


def test_me_returns_current_user(auth_client, user):
    response = auth_client.get("/api/auth/me/")
    assert response.status_code == 200
    assert response.data["email"] == user.email


def test_logout_deletes_token(auth_client, user):
    Token.objects.get_or_create(user=user)
    response = auth_client.post("/api/auth/logout/")
    assert response.status_code == 204
    assert not Token.objects.filter(user=user).exists()


def test_order_list_requires_authentication(api_client):
    response = api_client.get("/api/orders/")
    assert response.status_code in (401, 403)


def test_order_list_is_scoped_to_owner(auth_client, user, make_address, make_product, django_user_model):
    address = make_address(user)
    product = make_product(stock=5)
    auth_client.post(
        "/api/orders/",
        {"shipping_address": address.id, "items": [{"product": product.id, "quantity": 1}]},
        format="json",
    )

    other = django_user_model.objects.create_user(email="jiny@example.com", password="heslo123")
    from rest_framework.test import APIClient

    other_client = APIClient()
    other_client.force_authenticate(other)

    response = other_client.get("/api/orders/")
    assert response.status_code == 200
    assert len(response.data) == 0
