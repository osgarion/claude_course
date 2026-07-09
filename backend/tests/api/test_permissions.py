"""Plný request/response cyklus přes APIClient: routing, auth, permissions."""
import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def test_user_cannot_access_foreign_address(make_address, user, django_user_model):
    owner = user
    other = django_user_model.objects.create_user("uzivatel_b", password="heslo123")
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
