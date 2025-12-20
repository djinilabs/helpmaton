import path from "path";

import { sentryVitePlugin } from "@sentry/vite-plugin";
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

  // Determine if we should enable Sentry plugin (only for production deployments, not PR/staging)
  // Only enable if we have all required Sentry configuration (org, project, authToken)
  // This ensures releases are only created for production, not PR deployments
  const sentryOrg = env.SENTRY_ORG;
  const sentryProject = env.SENTRY_PROJECT;
  const sentryAuthToken = env.SENTRY_AUTH_TOKEN;
  const githubSha = env.GITHUB_SHA;

  // Generate release version: use commit SHA if available, otherwise use timestamp
  const release = githubSha || `release-${Date.now()}`;

  // Build plugins array
  const plugins = [react()];

  // Add Sentry plugin only if we have all required configuration
  // This will only be true in production deployments where all Sentry vars are set
  if (sentryOrg && sentryProject && sentryAuthToken) {
    plugins.push(
      sentryVitePlugin({
        org: sentryOrg,
        project: sentryProject,
        authToken: sentryAuthToken,
        release: {
          name: release,
        },
        sourcemaps: {
          assets: "./**",
          ignore: ["node_modules"],
          filesToDeleteAfterUpload: "../backend/public/**/*.map",
        },
      })
    );
  }

  return {
    plugins,
    define: {
      "process.env": {},
      // Expose the site key to the frontend
      "import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY":
        JSON.stringify(turnstileSiteKey),
      // Expose the Sentry release version to the frontend
      "import.meta.env.VITE_SENTRY_RELEASE": JSON.stringify(
        env.VITE_SENTRY_RELEASE || release
      ),
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
