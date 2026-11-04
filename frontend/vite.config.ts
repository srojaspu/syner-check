import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Sonner injects a <style> tag at runtime via __insertCSS(). The backend CSP
 * enforces `style-src 'self'` and rejects inline <style> elements; since
 * `sonner/dist/styles.css` is already bundled via `src/index.css`, we
 * neutralize __insertCSS() so no inline <style> is ever created.
 */
function stripSonnerInlineCss() {
  return {
    name: "strip-sonner-inline-css",
    transform(code: string, id: string) {
      if (!id.includes("sonner") || !code.includes("__insertCSS")) return null;
      return {
        code: code.replace(
          "if (!code || typeof document == 'undefined') return",
          "return;",
        ),
        map: null,
      };
    },
  };
}

// Build output is served by FastAPI under /static/frontend/.
export default defineConfig({
  plugins: [stripSonnerInlineCss(), react(), tailwindcss()],
  optimizeDeps: {
    exclude: ["sonner"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
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
          icons: ["@hugeicons/react", "@hugeicons/core-free-icons"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Preserve the browser's Host header: the backend's CSRF origin check
      // compares Origin against Host on writes. With changeOrigin:true the
      // proxy sends Host=127.0.0.1:8000 while the browser sends
      // Origin=http://localhost:5173, producing "Origen no permitido."
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: false },
      "/auth": { target: "http://127.0.0.1:8000", changeOrigin: false },
      "/static/img": { target: "http://127.0.0.1:8000", changeOrigin: false },
    },
  },
});
