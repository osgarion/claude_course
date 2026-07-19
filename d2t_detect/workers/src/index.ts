import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { authOptional } from "./auth/middleware.ts";
import { MODEL_ID, MODEL_VERSION } from "./model.ts";
import assessments from "./routes/assessments.ts";
import auth from "./routes/auth.ts";
import predict from "./routes/predict.ts";
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
  if (error instanceof HTTPException) {
    return c.json({ detail: error.message }, error.status);
  }
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(
    `Unhandled error: ${c.req.method} ${new URL(c.req.url).pathname}\n` +
      `${err.name}: ${err.message}\n${err.stack ?? "(no stack)"}`,
  );
  return c.json({ detail: "Something went wrong." }, 500);
});

app.notFound((c) => c.json({ detail: "Not found." }, 404));

export default app;
