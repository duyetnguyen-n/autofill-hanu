import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => {
  const cloudOrigin=process.env.HANU_CLOUD_ORIGIN??'';
  const common={outDir:cloudOrigin?(process.env.HANU_CLOUD_OUT_DIR??'dist-cloud'):'dist',define:{__HANU_CLOUD_ORIGIN__:JSON.stringify(cloudOrigin)}};
  if (mode === "background" || mode === "content" || mode === 'facebook-content') {
    return {
      define:common.define,
      build: {
        emptyOutDir: false,
        lib: {
          entry: resolve(__dirname, `src/${mode}.ts`),
          formats: ["iife"],
          name: `Hanu${mode.split('-').map(p=>p[0].toUpperCase()+p.slice(1)).join('')}`,
          fileName: () => `${mode}.js`
        },
        outDir: common.outDir,
        rollupOptions: { output: { assetFileNames: "assets/[name]-[hash][extname]" } }
      }
    };
  }

  return {
    define:common.define,
    publicDir: "public",
    build: {
      emptyOutDir: true,
      outDir: common.outDir,
      rollupOptions: { input: [resolve(__dirname, "sidepanel.html"),resolve(__dirname, "connection.html"),resolve(__dirname, "google-direct.html")] }
    }
  };
});
