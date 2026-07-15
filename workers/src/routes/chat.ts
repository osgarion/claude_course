import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";

import { rateLimitChat } from "../auth/middleware.js";
import { parseChatRequest } from "../domain/chat.js";
import { runChat } from "../services/assistant.js";
import type { AppEnv } from "../types.js";

const chat = new Hono<AppEnv>();

chat.post("/", rateLimitChat, async (c) => {
  // Nejdřív tvar vstupu: rozbitý request je chyba klienta bez ohledu na to,
  // jestli je chat nakonfigurovaný. (Ušetří to i zbytečnou práci.)
  const input = parseChatRequest(await c.req.json().catch(() => null));
  if (!input) {
    return c.json({ detail: "Chybná zpráva nebo historie konverzace." }, 400);
  }

  // Bez klíče radši 503 než tichý pád na "nic" - ať je hned vidět, že chat
  // není nakonfigurovaný, a ne že "jen nějak divně mlčí".
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ detail: "Chat není nakonfigurovaný." }, 503);
  }

  try {
    const reply = await runChat(c, input.history, input.message);

    // Historii vrací server jen jako pohodlí pro klienta (ten si ji ukládá do
    // sessionStorage). Na serveru se konverzace nikde neukládá.
    return c.json({
      reply,
      history: [
        ...input.history,
        { role: "user", content: input.message },
        { role: "assistant", content: reply },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return c.json({ detail: "Asistent je vytížený, zkus to za chvíli." }, 503);
    }
    if (error instanceof Anthropic.APIError) {
      console.error("Anthropic API selhalo:", error);
      return c.json({ detail: "Asistent je dočasně nedostupný." }, 502);
    }
    throw error;
  }
});

export default chat;
