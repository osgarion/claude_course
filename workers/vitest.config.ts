import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Migrace se načtou v Node (při startu vitestu) a předají do Workeru jako
// binding - uvnitř Workeru žádný filesystem není, jinak by je nešlo přečíst.
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Každý testovací soubor dostane vlastní izolované úložiště.
      isolatedStorage: true,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: migrations },
      },
    }),
  ],
  test: {
    setupFiles: ["./tests/setup.ts"],
    // Každý testovací soubor = vlastní workerd instance a ta si natáhne celý
    // bundle včetně @anthropic-ai/sdk. Při plné paralelizaci to workerdy
    // shodilo (ECONNRESET) - a co je horší, vitest pak hlásil suitu zeleně,
    // protože testy ze spadlých souborů prostě zmizely z počtu.
    // Strop je pojistka proti tichému "prošlo, ale nespustilo se".
    maxWorkers: 4,
  },
});
