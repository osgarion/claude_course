// ---------- Plovoucí chat s podporou ----------
//
// Widget si vykresluje vlastní DOM sám. Markup by se jinak musel kopírovat do
// index.html, product.html i pokladna.html a při každé změně opravovat třikrát.
//
// Historie konverzace žije v sessionStorage (tj. do zavření záložky) a posílá
// se s každým dotazem na server - server si konverzaci nikde neukládá.
// Server jí proto nesmí věřit a tvar si tvrdě validuje (viz domain/chat.ts).

const CHAT_HISTORY_KEY = "pixelpantry_chat";
const UVODNI_HLASKA = "Ahoj! Zeptej se mě na produkty, slevové kódy nebo svoji objednávku.";

function readHistory() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CHAT_HISTORY_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(history) {
  sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(history));
}

/** Text se vkládá přes textContent, ne innerHTML - odpověď modelu není HTML. */
function messageElement(role, text, pending = false) {
  const div = document.createElement("div");
  div.className = `chat-msg ${role}${pending ? " pending" : ""}`;
  div.textContent = text;
  return div;
}

function initChat() {
  const widget = document.createElement("div");
  widget.id = "chat-widget";
  widget.innerHTML = `
    <button id="chat-toggle" title="Zeptat se podpory" aria-label="Chat s podporou">💬</button>
    <div id="chat-panel" hidden>
      <div class="chat-header">
        <span>Podpora Pixel Pantry</span>
        <button id="chat-clear" class="chat-header-btn" title="Smazat konverzaci">↺</button>
        <button id="chat-close" class="chat-header-btn" title="Zavřít">×</button>
      </div>
      <div id="chat-messages"></div>
      <form id="chat-form">
        <input id="chat-input" type="text" autocomplete="off"
               placeholder="Máte pixelové hrnky?" maxlength="4000">
        <button type="submit">Poslat</button>
      </form>
    </div>`;
  document.body.appendChild(widget);

  const panel = widget.querySelector("#chat-panel");
  const box = widget.querySelector("#chat-messages");
  const input = widget.querySelector("#chat-input");

  function render(pending = false) {
    box.replaceChildren();
    const history = readHistory();

    if (history.length === 0) {
      box.appendChild(messageElement("assistant", UVODNI_HLASKA));
    }
    for (const message of history) {
      box.appendChild(messageElement(message.role, message.content));
    }
    if (pending) {
      box.appendChild(messageElement("assistant", "přemýšlím…", true));
    }
    box.scrollTop = box.scrollHeight;
  }

  widget.querySelector("#chat-toggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      render();
      input.focus();
    }
  });

  widget.querySelector("#chat-close").addEventListener("click", () => {
    panel.hidden = true;
  });

  widget.querySelector("#chat-clear").addEventListener("click", () => {
    writeHistory([]);
    render();
  });

  widget.querySelector("#chat-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;

    const history = readHistory();
    // Optimisticky dokreslíme vlastní zprávu, ať uživatel nečeká na server.
    writeHistory([...history, { role: "user", content: message }]);
    input.value = "";
    render(true);

    try {
      // apiFetch (app.js) přidá Authorization token, pokud je uživatel
      // přihlášený - podle toho server pozná, čí objednávky smí ukázat.
      const response = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message, history }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail ?? "Chat teď nefunguje.");
      }
      writeHistory(data.history);
    } catch (error) {
      // Neúspěšný dotaz z historie zase odebereme, ať se do příštího
      // requestu neposílá zpráva, na kterou asistent nikdy neodpověděl.
      writeHistory(history);
      render();
      box.appendChild(messageElement("assistant", `⚠️ ${error.message}`));
      box.scrollTop = box.scrollHeight;
      return;
    }

    render();
  });
}

document.addEventListener("DOMContentLoaded", initChat);
