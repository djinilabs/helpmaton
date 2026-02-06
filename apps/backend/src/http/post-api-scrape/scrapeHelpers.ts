/** Hosts that use strong anti-bot measures; we skip resource blocking and add delay/referer */
export const STRICT_DOMAIN_HOSTS = ["www.reddit.com", "old.reddit.com"];

/** Phrases that indicate a block/security page rather than real content */
export const BLOCK_PAGE_PHRASES = [
  "blocked by network security",
  "file a ticket",
  "checking your browser",
  "access denied",
  "just a moment",
  "please complete the security check",
];

/** Strong indicators: one match is enough to treat as block page (e.g. Reddit/Cloudflare block text) */
export const STRONG_BLOCK_PAGE_PHRASES = [
  "blocked by network security",
  "file a ticket",
];

export function isStrictDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return STRICT_DOMAIN_HOSTS.some((h) => host === h);
  } catch {
    return false;
  }
}

/**
 * Normalize URL for strict domains (e.g. use old.reddit.com for better success)
 */
export function normalizeUrlForStrictDomain(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "www.reddit.com") {
      u.hostname = "old.reddit.com";
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/** Referer to send for same-site navigation signal (reduces some WAF blocks) */
export function getRefererForUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "www.reddit.com" || host === "old.reddit.com") {
      return `https://${host}/`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Message we throw when block page is detected after retries */
export const BLOCK_PAGE_ERROR_MESSAGE =
  "Content could not be loaded: the server returned a block or security page. Try another URL or provider.";

/**
 * Returns true if the error is a known scraper/website failure (timeouts, block pages).
 * Such errors should not be reported to Sentry; they are returned to the client and recorded in the conversation.
 * Checks the error and its cause chain so wrapped Puppeteer errors are still detected.
 */
export function isScraperRelatedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message =
    typeof (err as { message?: unknown }).message === "string"
      ? ((err as { message: string }).message as string)
      : "";
  const name =
    typeof (err as { name?: unknown }).name === "string"
      ? ((err as { name: string }).name as string)
      : "";
  if (name === "TimeoutError") return true;
  const lower = message.toLowerCase();
  if (lower.includes("timeout") && lower.includes("exceeded")) return true;
  if (message.includes(BLOCK_PAGE_ERROR_MESSAGE)) return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause) return isScraperRelatedError(cause);
  return false;
}

/**
 * Returns true if content looks like a block/security page.
 * Requires either (1) one strong phrase, or (2) two or more of any block phrases,
 * to reduce false positives (e.g. "access denied" in a long article).
 */
export function isBlockPageContent(xmlContent: string): boolean {
  const lower = xmlContent.toLowerCase();
  const hasStrong = STRONG_BLOCK_PAGE_PHRASES.some((phrase) =>
    lower.includes(phrase)
  );
  if (hasStrong) return true;
  const matchCount = BLOCK_PAGE_PHRASES.filter((phrase) =>
    lower.includes(phrase)
  ).length;
  return matchCount >= 2;
}
