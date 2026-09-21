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
    rollupOptions: {
      output: {
        // Split large vendors into dedicated chunks to keep the initial
        // bundle under the default 500 kB chunk-size warning limit.
        // xlsx is not listed here: it is lazy-loaded via dynamic import
        // and already lands in its own chunk.
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          table: ["@tanstack/react-table"],
          icons: ["lucide-react"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/auth": "http://127.0.0.1:8000",
    },
  },
});
