const SHOPIFY_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function normalizeShopifyShopDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  const withoutPath = withoutProtocol.split("/")[0] || "";
  return withoutPath;
}

export function assertValidShopifyShopDomain(input: string): string {
  const normalized = normalizeShopifyShopDomain(input);
  if (!normalized || !SHOPIFY_DOMAIN_PATTERN.test(normalized)) {
    throw new Error(
      "shopDomain must be a valid Shopify domain like my-store.myshopify.com"
    );
  }
  return normalized;
}
