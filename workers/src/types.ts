/**
 * Aplikační typy. Bindingy (DB, ASSETS, AUTH_LIMITER, PBKDF2_ITERATIONS)
 * generuje `npx wrangler types` z wrangler.jsonc do worker-configuration.d.ts
 * jako Cloudflare.Env - neudržujeme je tady ručně, ať se nerozejdou s configem.
 */

export interface AuthUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  is_staff: number;
}

export interface Variables {
  /** null = anonym. Anonym není chyba - guest checkout je povolený. */
  user: AuthUser | null;
}

export type AppEnv = { Bindings: Cloudflare.Env; Variables: Variables };
