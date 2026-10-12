import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  if (mode === "background" || mode === "content") {
    return {
      build: {
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, `src/${mode}.ts`),
          formats: ["iife"],
          name: `Hanu${mode[0].toUpperCase()}${mode.slice(1)}`,
          fileName: () => `${mode}.js`
        },
        outDir: "dist",
        rollupOptions: { output: { assetFileNames: "assets/[name]-[hash][extname]" } }
      }
    };
  }

  return {
    publicDir: "public",
    build: {
      emptyOutDir: true,
      outDir: "dist",
      rollupOptions: { input: [resolve(__dirname, "sidepanel.html"),resolve(__dirname, "connection.html")] }
    }
  };
});
