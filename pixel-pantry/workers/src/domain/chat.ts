/**
 * Validace vstupu chatu. Čistá logika - žádná DB, žádné Hono.
 *
 * Historii konverzace drží KLIENT (v sessionStorage) a posílá ji s každým
 * dotazem. Je to tedy plnohodnotný uživatelský vstup: kdokoli může poslat
 * libovolně dlouhou historii, cizí role nebo 10 MB textu. Tvar proto
 * kontrolujeme tvrdě - jednak kvůli nákladům (každý token stojí peníze),
 * jednak aby se do API nedostal nesmysl.
 *
 * Pozor: tohle NENÍ obrana proti prompt injection. Zákazník si do historie
 * může napsat cokoli. Obrana proti tomu stojí na tom, co nástroje umí
 * (viz services/assistant.ts), ne na tom, co je v textu.
 */
import { z } from "zod";

export const MAX_HISTORY_MESSAGES = 30;
export const MAX_MESSAGE_CHARS = 4000;

const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  history: z.array(chatMessageSchema).max(MAX_HISTORY_MESSAGES).default([]),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Vrátí ověřený vstup, nebo null, když je tvar rozbitý (-> 400). */
export function parseChatRequest(body: unknown): ChatRequest | null {
  const parsed = chatRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
