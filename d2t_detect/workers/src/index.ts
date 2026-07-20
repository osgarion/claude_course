import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { authOptional } from "./auth/middleware.ts";
import { persistError } from "./errors.ts";
import { MODEL_ID, MODEL_VERSION } from "./model.ts";
import assessments from "./routes/assessments.ts";
import auth from "./routes/auth.ts";
import predict from "./routes/predict.ts";
import { withSentry } from "./sentry.ts";
import type { AppEnv } from "./types.ts";

const app = new Hono<AppEnv>();

// Tolerate a trailing slash on /api/* paths so both /api/foo and /api/foo/ work.
app.use("/api/*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.length > 5 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
    return app.fetch(new Request(url, c.req.raw), c.env, c.executionCtx);
  }
  await next();
});

// Load the user from the token if present. Anonymous is allowed; routes that
// need a login enforce it themselves via authRequired.
app.use("/api/*", authOptional);

app.get("/api/health", (c) =>
  c.json({ status: "ok", model_id: MODEL_ID, version: MODEL_VERSION }),
);

app.route("/api/auth", auth);
app.route("/api/predict", predict);
app.route("/api/assessments", assessments);

app.onError((error, c) => {
  // Expected client errors (400/401/404/409/429) are not "errors" worth logging.
  if (error instanceof HTTPException) {
    return c.json({ detail: error.message }, error.status);
  }

  // Unexpected server error: log everywhere. (1) Workers Logs via console.error
  // (observability enabled), (2) this project's own D1 error_log, (3) Sentry if
  // a DSN secret is set. All three are project-scoped, so they never mix with
  // pixel-pantry.
  const err = error instanceof Error ? error : new Error(String(error));
  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  console.error(
    `Unhandled error: ${method} ${path}\n${err.name}: ${err.message}\n${err.stack ?? "(no stack)"}`,
  );

  // Persist without blocking the response (best-effort).
  c.executionCtx.waitUntil(
    persistError(c.env.DB, {
      method,
      path,
      status: 500,
      name: err.name,
      message: err.message,
      stack: err.stack,
    }),
  );

  if (c.env.SENTRY_DSN) Sentry.captureException(error);
  return c.json({ detail: "Something went wrong." }, 500);
});

app.notFound((c) => c.json({ detail: "Not found." }, 404));

// withSentry wraps the whole handler — catches errors outside onError too.
// No DSN => no-op, so default behaviour is unchanged.
export default withSentry(app);
