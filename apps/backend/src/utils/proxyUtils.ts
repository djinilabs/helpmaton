import { badRequest, internal } from "@hapi/boom";

/**
 * Parse proxy URL to extract server, username, and password
 */
export function parseProxyUrl(proxyUrl: string): {
  server: string;
  username?: string;
  password?: string;
} {
  try {
    const url = new URL(proxyUrl);
    return {
      server: `${url.protocol}//${url.host}`,
      username: url.username || undefined,
      password: url.password || undefined,
    };
  } catch {
    throw badRequest(`Invalid proxy URL format: ${proxyUrl}`);
  }
}

/**
 * Get random proxy URL from environment variable
 */
export function getRandomProxyUrl(): string {
  const proxyUrlsEnv = process.env.DECODO_PROXY_URLS;
  if (!proxyUrlsEnv) {
    throw internal("DECODO_PROXY_URLS environment variable is not set");
  }

  let proxyUrls: string[];
  try {
    proxyUrls = JSON.parse(proxyUrlsEnv);
  } catch {
    throw internal("DECODO_PROXY_URLS must be a valid JSON array of strings");
  }

  if (!Array.isArray(proxyUrls) || proxyUrls.length === 0) {
    throw internal("DECODO_PROXY_URLS must be a non-empty array");
  }

  if (!proxyUrls.every((url) => typeof url === "string")) {
    throw internal("All items in DECODO_PROXY_URLS must be strings");
  }

  // Randomly select one proxy URL
  const randomIndex = Math.floor(Math.random() * proxyUrls.length);
  return proxyUrls[randomIndex]!;
}

