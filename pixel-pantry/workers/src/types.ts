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

/**
 * Cloudflare.Env generuje `wrangler types` z wrangler.jsonc. Tajné hodnoty
 * (secrety) se tam ale ZÁMĚRNĚ nedeklarují jako var - Cloudflare nedovolí var
 * a secret stejného jména - takže je do typu doplňujeme ručně. Volitelné,
 * protože bez nastaveného secretu jsou undefined a fail-safe větve to čekají
 * (prázdné = feature vypnutá). Zatím jen SENTRY_DSN; ostatní klíče jsou dnes
 * ještě prázdné vary ve wrangler.jsonc (přijdou sem, až se zapnou jako secret).
 */
export type Bindings = Cloudflare.Env & {
  readonly SENTRY_DSN?: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
