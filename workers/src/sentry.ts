import * as Sentry from "@sentry/cloudflare";

import type { Bindings } from "./types.js";

/**
 * Obalí Worker handler Sentry instrumentací. Feature-gated přes SENTRY_DSN:
 * nenastavené (undefined) = `enabled: false`, takže bez klíče se nic
 * nereportuje a e-shop jede dál (žádná chyba, žádné síťové volání na Sentry).
 * DSN se dodává mimo git - lokálně přes .dev.vars, v produkci
 * `npx wrangler secret put SENTRY_DSN` (NE jako var ve wrangler.jsonc, viz tam).
 */
export function withSentry<T extends ExportedHandler<Bindings>>(handler: T): T {
  return Sentry.withSentry(
    (env: Bindings) => ({
      dsn: env.SENTRY_DSN,
      enabled: !!env.SENTRY_DSN,
      environment: "production",
      tracesSampleRate: 1.0,
      sendDefaultPii: true,
    }),
    handler,
  );
}
