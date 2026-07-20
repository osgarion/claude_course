import type { Bindings } from "./types.ts";

/**
 * Persist one unexpected server error into this project's D1 (error_log table).
 * Best-effort: a logging failure must never mask the original error, so it is
 * swallowed here (the console.error in index.ts is the always-on fallback).
 *
 * Stacks are truncated so a runaway trace can't bloat a D1 row.
 */
export async function persistError(
  db: D1Database,
  fields: { method: string; path: string; status: number; name: string; message: string; stack?: string },
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO error_log (method, path, status, name, message, stack)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        fields.method,
        fields.path,
        fields.status,
        fields.name.slice(0, 200),
        fields.message.slice(0, 2000),
        (fields.stack ?? "").slice(0, 8000),
      )
      .run();
  } catch (e) {
    console.error(`error_log insert failed: ${String(e)}`);
  }
}
