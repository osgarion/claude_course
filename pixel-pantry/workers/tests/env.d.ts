/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "cloudflare:test" {
  // Bindingy aplikace (Cloudflare.Env generuje `wrangler types`) + migrace
  // předané z vitest.config.ts - uvnitř Workeru není filesystem, takže je
  // jinak načíst nejde.
  interface ProvidedEnv extends Cloudflare.Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}

// Vite umí naimportovat soubor jako text (`?raw`) - používají to meta testy,
// které kontrolují samotné zdrojáky.
declare module "*?raw" {
  const content: string;
  export default content;
}
