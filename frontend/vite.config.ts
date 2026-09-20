import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build output is served by FastAPI under /static/frontend/.
export default defineConfig({
  plugins: [react()],
  base: "/static/frontend/",
  build: {
    outDir: "../app/static/frontend",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/auth": "http://127.0.0.1:8000",
    },
  },
});
