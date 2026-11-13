import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", assetsDir: "assets" },
  server: {
    // the admin API runs as the real Netlify function under scripts/cms-dev-server.mjs
    // (`npm run cms` starts both); in production /api/* is the deployed function
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
});
