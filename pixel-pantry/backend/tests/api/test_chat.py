"""Chat endpoint: Anthropic je vždy mockovaný - žádné reálné volání API v testech."""
from unittest.mock import patch

import pytest
from django.test import override_settings

pytestmark = pytest.mark.django_db


class _FakeTextBlock:
    type = "text"

    def __init__(self, text):
        self.text = text

    def model_dump(self):
        return {"type": "text", "text": self.text}


class _FakeToolUseBlock:
    type = "tool_use"

    def __init__(self, tool_id, name, tool_input):
        self.id = tool_id
        self.name = name
        self.input = tool_input

    def model_dump(self):
        return {"type": "tool_use", "id": self.id, "name": self.name, "input": self.input}


class _FakeResponse:
    def __init__(self, stop_reason, content):
        self.stop_reason = stop_reason
        self.content = content


def _text_response(text):
    return _FakeResponse("end_turn", [_FakeTextBlock(text)])


def test_chat_returns_503_without_api_key(api_client):
    response = api_client.post("/api/chat/", {"message": "Ahoj"}, format="json")
    assert response.status_code == 503


def test_chat_requires_message(api_client):
    with override_settings(ANTHROPIC_API_KEY="fake-key"):
        response = api_client.post("/api/chat/", {"message": ""}, format="json")
    assert response.status_code == 400


def test_chat_returns_text_reply(api_client):
    with override_settings(ANTHROPIC_API_KEY="fake-key"):
        with patch("catalog.assistant.anthropic.Anthropic") as MockAnthropic:
            client = MockAnthropic.return_value
            client.messages.create.return_value = _text_response("Ahoj, jak mohu pomoci?")

            response = api_client.post(
                "/api/chat/", {"message": "Ahoj", "history": []}, format="json"
            )

    assert response.status_code == 200
    assert response.data["reply"] == "Ahoj, jak mohu pomoci?"
    assert response.data["history"][-1] == {"role": "assistant", "content": "Ahoj, jak mohu pomoci?"}


def test_chat_executes_tool_before_final_reply(api_client, make_product):
    make_product(name="Retro klávesnice", stock=3)

    tool_call = _FakeResponse(
        "tool_use",
        [_FakeToolUseBlock("tool_1", "list_products", {"query": "klávesnice"})],
    )
    final = _text_response("Ano, klávesnici máme skladem.")

    with override_settings(ANTHROPIC_API_KEY="fake-key"):
        with patch("catalog.assistant.anthropic.Anthropic") as MockAnthropic:
            client = MockAnthropic.return_value
            client.messages.create.side_effect = [tool_call, final]

            response = api_client.post(
                "/api/chat/", {"message": "Máte klávesnici?", "history": []}, format="json"
            )

    assert response.status_code == 200
    assert response.data["reply"] == "Ano, klávesnici máme skladem."
    assert client.messages.create.call_count == 2


def test_anonymous_request_does_not_offer_order_tools(api_client):
    with override_settings(ANTHROPIC_API_KEY="fake-key"):
        with patch("catalog.assistant.anthropic.Anthropic") as MockAnthropic:
            client = MockAnthropic.return_value
            client.messages.create.return_value = _text_response("Ahoj!")

            api_client.post("/api/chat/", {"message": "Ahoj", "history": []}, format="json")

    passed_tools = client.messages.create.call_args.kwargs["tools"]
    tool_names = {t["name"] for t in passed_tools}
    assert "create_order" not in tool_names
    assert "get_order_status" not in tool_names


def test_authenticated_request_offers_order_tools(auth_client):
    with override_settings(ANTHROPIC_API_KEY="fake-key"):
        with patch("catalog.assistant.anthropic.Anthropic") as MockAnthropic:
            client = MockAnthropic.return_value
            client.messages.create.return_value = _text_response("Ahoj!")

            auth_client.post("/api/chat/", {"message": "Ahoj", "history": []}, format="json")

    passed_tools = client.messages.create.call_args.kwargs["tools"]
    tool_names = {t["name"] for t in passed_tools}
    assert "create_order" in tool_names


def test_chat_throttled_after_limit(api_client):
    with override_settings(ANTHROPIC_API_KEY="fake-key"):
        with patch("catalog.assistant.anthropic.Anthropic") as MockAnthropic:
            client = MockAnthropic.return_value
            client.messages.create.return_value = _text_response("Ahoj!")

            for _ in range(20):
                response = api_client.post(
                    "/api/chat/", {"message": "Ahoj", "history": []}, format="json"
                )
                assert response.status_code == 200
            last = api_client.post(
                "/api/chat/", {"message": "Ahoj", "history": []}, format="json"
            )

    assert last.status_code == 429
