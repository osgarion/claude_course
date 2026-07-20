import * as Sentry from "@sentry/cloudflare";

import type { Bindings } from "./types.ts";

/**
 * Wraps the Worker handler in Sentry instrumentation. Feature-gated by
 * SENTRY_DSN: unset (undefined) => `enabled: false`, so with no key nothing is
 * reported and the app runs on (no error, no network call to Sentry). The DSN
 * is supplied outside git — locally via .dev.vars, in production via
 * `npx wrangler secret put SENTRY_DSN` (NOT as a var in wrangler.jsonc).
 *
 * Use a Sentry project dedicated to d2t_detect — do not reuse pixel-pantry's
 * DSN, or the two projects' errors would land in the same Sentry inbox.
 */
export function withSentry<T extends ExportedHandler<Bindings>>(handler: T): T {
  return Sentry.withSentry(
    (env: Bindings) => ({
      dsn: env.SENTRY_DSN,
      enabled: !!env.SENTRY_DSN,
      environment: "production",
      tracesSampleRate: 1.0,
      sendDefaultPii: false, // teaching app — don't ship request bodies/IPs by default
    }),
    handler,
  );
}
