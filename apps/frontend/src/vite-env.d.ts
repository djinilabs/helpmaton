/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_POSTHOG_API_KEY?: string;
  readonly VITE_POSTHOG_API_HOST?: string;
  readonly VITE_ENV?: string;
  readonly VITE_CLOUDFLARE_TURNSTILE_SITE_KEY?: string;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

