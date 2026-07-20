/**
 * Přihlašovací tokeny (náhrada DRF TokenAuthentication).
 *
 * V databázi je jen sha256 tokenu, nikdy holý token - únik dumpu databáze
 * pak neprozradí živá přihlášení (DRF drží token v plaintextu, tohle je
 * vědomé vylepšení). Vyhledání je jediné čtení přes primární klíč, takže to
 * nestojí žádný PBKDF2 čas na každém requestu.
 *
 * Drát je stejný jako u DRF: `Authorization: Token <hex>`.
 */

const TOKEN_BYTES = 32;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Nový náhodný token - vrací se klientovi jen jednou. */
export function generateToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** Otisk, který se ukládá do databáze. */
export async function hashToken(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawToken));
  return toHex(new Uint8Array(digest));
}

/** Vytáhne holý token z hlavičky `Authorization: Token <hex>`. */
export function tokenFromHeader(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Token\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
