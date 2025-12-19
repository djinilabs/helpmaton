import path from "path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file from apps/frontend directory (where this config file is located)
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const envDir = path.resolve(__dirname);
  const env = loadEnv(mode, envDir, "");

  // Map CLOUDFLARE_TURNSTILE_SITE_KEY to VITE_CLOUDFLARE_TURNSTILE_SITE_KEY
  // This allows using either CLOUDFLARE_TURNSTILE_SITE_KEY or VITE_CLOUDFLARE_TURNSTILE_SITE_KEY
  const turnstileSiteKey =
    env.CLOUDFLARE_TURNSTILE_SITE_KEY ||
    env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY ||
    "";

  return {
    plugins: [react()],
    define: {
      "process.env": {},
      // Expose the site key to the frontend
      "import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY":
        JSON.stringify(turnstileSiteKey),
    },
    build: {
      sourcemap: true,
      outDir: "../backend/public",
      rollupOptions: {
        output: {
          experimentalMinChunkSize: 200000, // 200KB minimum chunk size
        },
      },
    },
    server: {
      proxy: {
        "/api": {
          target: "http://localhost:3333",
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req) => {
              // Set X-Forwarded-Host header so auth library can use it
              if (req.headers.host) {
                proxyReq.setHeader("X-Forwarded-Host", req.headers.host);
              }
            });
          },
        },
      },
    },
  };
});
