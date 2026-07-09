"""Jeden uživatel může produkt recenzovat jen jednou (unique_together product+user)."""
import pytest

pytestmark = pytest.mark.django_db


def test_second_review_from_same_user_is_rejected(auth_client, make_product, user):
    from catalog.models import Review

    product = make_product(name="Odznaky", price="99.00", stock=10)

    first = auth_client.post(
        f"/api/products/{product.id}/reviews/",
        {"rating": 5, "comment": "Skvělé"},
        format="json",
    )
    second = auth_client.post(
        f"/api/products/{product.id}/reviews/",
        {"rating": 3, "comment": "Rozmyslel jsem si to"},
        format="json",
    )

    assert first.status_code == 201
    assert second.status_code == 400
    assert Review.objects.filter(product=product, user=user).count() == 1


def test_anonymous_only_sees_approved_reviews(api_client, make_product, user, django_user_model):
    from catalog.models import Review

    other_user = django_user_model.objects.create_user("uzivatel_b", password="heslo123")
    product = make_product(name="Podložka", price="199.00", stock=5)
    Review.objects.create(product=product, user=user, rating=5, is_approved=True)
    Review.objects.create(product=product, user=other_user, rating=1, is_approved=False)

    response = api_client.get(f"/api/products/{product.id}/reviews/")

    assert response.status_code == 200
    assert len(response.data) == 1
