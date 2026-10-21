import { build } from "esbuild";
await build({
  entryPoints: [
    "integrations/hcmue/runner/main.ts",
    "integrations/hcmue/runner/worker.ts",
  ],
  outdir: "build/hcmue/runner",
  platform: "node",
  target: "node24",
  bundle: true,
  format: "esm",
  outExtension: { ".js": ".mjs" },
  packages: "bundle",
  banner: {
    js: "import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);",
  },
  external: ["node:*"],
});
