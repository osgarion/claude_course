"""Rate limiting: sdílený rozpočet 'auth' pro login+register, globální anon limit."""
import pytest

pytestmark = pytest.mark.django_db

AUTH_LIMIT = 10
ANON_LIMIT = 60


def _login_attempt(client):
    return client.post(
        "/api/auth/login/", {"email": "kdokoli@example.com", "password": "spatne"}, format="json"
    )


def test_login_throttled_after_limit(api_client):
    for _ in range(AUTH_LIMIT):
        assert _login_attempt(api_client).status_code == 400
    response = _login_attempt(api_client)
    assert response.status_code == 429
    assert "Retry-After" in response.headers


def test_login_and_register_share_auth_budget(api_client):
    for _ in range(AUTH_LIMIT):
        _login_attempt(api_client)
    response = api_client.post(
        "/api/auth/register/",
        {"email": "novy@example.com", "password": "velmi-tajne-heslo-1"},
        format="json",
    )
    assert response.status_code == 429


def test_anon_browsing_throttled_after_limit(api_client):
    for _ in range(ANON_LIMIT):
        assert api_client.get("/api/products/").status_code == 200
    assert api_client.get("/api/products/").status_code == 429


def test_authenticated_user_not_bound_by_anon_limit(auth_client):
    for _ in range(ANON_LIMIT + 1):
        assert auth_client.get("/api/products/").status_code == 200
