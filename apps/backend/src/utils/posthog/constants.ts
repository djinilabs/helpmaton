export const POSTHOG_BASE_URLS = [
  "https://us.posthog.com",
  "https://eu.posthog.com",
] as const;

export function normalizePosthogBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function isValidPosthogBaseUrl(url: string): boolean {
  const normalized = normalizePosthogBaseUrl(url);
  return POSTHOG_BASE_URLS.includes(normalized as (typeof POSTHOG_BASE_URLS)[number]);
}
