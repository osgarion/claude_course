import { defineConfig } from "vitest/config";

// Plain Node environment: the model parity test is pure math over the bundle
// JSON, no Worker runtime needed. (API/D1 tests can later use
// @cloudflare/vitest-pool-workers in a separate project.)
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
