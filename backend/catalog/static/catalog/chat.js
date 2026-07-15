// ---------- Zákaznický chatbot (plovoucí widget na všech stránkách obchodu) ----------
// Spoléhá na apiFetch/getCsrfToken z app.js (musí být načtený dřív).

const CHAT_HISTORY_KEY = "pixelpantry_chat_history";

function getChatHistory() {
  try {
    return JSON.parse(sessionStorage.getItem(CHAT_HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveChatHistory(history) {
  sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history));
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function initChatWidget() {
  const toggleBtn = document.getElementById("chat-toggle");
  const closeBtn = document.getElementById("chat-close");
  const panel = document.getElementById("chat-panel");
  const messagesEl = document.getElementById("chat-messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");

  let history = getChatHistory();
  let sending = false;

  function renderMessages() {
    messagesEl.innerHTML = history
      .map(
        (m) =>
          `<div class="chat-msg chat-msg-${m.role === "user" ? "user" : "bot"}">${escapeHtml(m.content)}</div>`
      )
      .join("");
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  toggleBtn.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) input.focus();
  });
  closeBtn.addEventListener("click", () => panel.classList.remove("open"));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (sending) return;
    const message = input.value.trim();
    if (!message) return;

    input.value = "";
    sending = true;
    history.push({ role: "user", content: message });
    renderMessages();

    apiFetch("/api/chat/", {
      method: "POST",
      body: JSON.stringify({ message, history: history.slice(0, -1) }),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw data;
        history = data.history;
        saveChatHistory(history);
      })
      .catch(() => {
        history.push({
          role: "assistant",
          content: "Omlouvám se, teď se s podporou nemůžu spojit. Zkus to prosím znovu.",
        });
      })
      .finally(() => {
        sending = false;
        renderMessages();
      });
  });

  renderMessages();
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("chat-toggle")) initChatWidget();
});
