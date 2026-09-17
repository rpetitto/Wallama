import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Where wrangler.jsonc's `assets.directory` expects to find the built SPA.
    outDir: "dist/client",
    emptyOutDir: true,
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src/react-app") },
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    proxy: {
      // `npm run dev` (wrangler) serves the API with the real bindings, so the
      // Vite dev server with HMR proxies to it rather than reimplementing it.
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
