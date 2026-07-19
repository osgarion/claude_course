import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";

// Schéma se do testovací D1 nalije jednou před během testů.
beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS);
});
