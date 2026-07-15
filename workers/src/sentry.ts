import * as Sentry from "@sentry/cloudflare";

/**
 * Obalí Worker handler Sentry instrumentací. Feature-gated přes SENTRY_DSN
 * stejným vzorem jako ANTHROPIC_API_KEY/STRIPE_SECRET_KEY: prázdné DSN =
 * `enabled: false`, takže bez klíče se nic nereportuje a e-shop jede dál
 * (žádná chyba, žádné síťové volání na Sentry). Skutečné DSN se dodává mimo
 * git - lokálně přes .dev.vars, v produkci `npx wrangler secret put SENTRY_DSN`.
 */
export function withSentry<T extends ExportedHandler<Cloudflare.Env>>(handler: T): T {
  return Sentry.withSentry(
    (env: Cloudflare.Env) => ({
      dsn: env.SENTRY_DSN,
      enabled: !!env.SENTRY_DSN,
      environment: "production",
      tracesSampleRate: 1.0,
      sendDefaultPii: true,
    }),
    handler,
  );
}
