"""build_tools: objednávkové/adresní nástroje smí model dostat jen pro
přihlášeného uživatele - čistá logika, bez DB (AnonymousUser nešahá do DB)."""
from types import SimpleNamespace

from django.contrib.auth.models import AnonymousUser

from catalog.assistant import build_tools

AUTH_ONLY_TOOLS = {
    "list_my_addresses",
    "list_my_orders",
    "get_order_status",
    "create_order",
    "cancel_my_order",
}


def test_anonymous_user_does_not_get_order_or_address_tools():
    tools = build_tools(AnonymousUser())
    names = {t["name"] for t in tools}

    assert "list_products" in names
    assert not (names & AUTH_ONLY_TOOLS)


def test_authenticated_user_gets_all_tools():
    fake_user = SimpleNamespace(is_authenticated=True)
    tools = build_tools(fake_user)
    names = {t["name"] for t in tools}

    assert "list_products" in names
    assert AUTH_ONLY_TOOLS <= names
