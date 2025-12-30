import { badRequest, boomify, internal, unauthorized } from "@hapi/boom";
import serverlessExpress from "@vendia/serverless-express";
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import express from "express";
import { jwtDecrypt } from "jose";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-core is installed in container image
import puppeteer, { type Browser, type Page } from "puppeteer-core";

import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { ensureError, flushSentry, Sentry } from "../../utils/sentry";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";
import { expressErrorHandler } from "../utils/errorHandler";

/**
 * Type definition for Puppeteer HTTPRequest
 * This matches the interface used by puppeteer-core
 */
interface HTTPRequest {
  resourceType(): string;
  url(): string;
  abort(): void;
  continue(): void;
}

/**
 * Type definition for Puppeteer accessibility snapshot (SerializedAXNode)
 * This matches the structure returned by page.accessibility.snapshot()
 * Used for type documentation - converted to Record<string, unknown> for processing
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface SerializedAXNode {
  role?: string;
  name?: string;
  value?: string | number;
  description?: string;
  keyshortcuts?: string;
  roledescription?: string;
  valuetext?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  readonly?: boolean;
  required?: boolean;
  selected?: boolean;
  checked?: boolean | "mixed";
  pressed?: boolean | "mixed";
  level?: number;
  valuemin?: number;
  valuemax?: number;
  autocomplete?: string;
  haspopup?: string;
  invalid?: string;
  orientation?: string;
  children?: SerializedAXNode[];
  [key: string]: unknown;
}

// Known tracker domains to block
const TRACKER_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.net",
  "facebook.com",
  "doubleclick.net",
  "adservice.google",
  "googlesyndication.com",
  "amazon-adsystem.com",
  "ads-twitter.com",
  "analytics.twitter.com",
  "scorecardresearch.com",
  "quantserve.com",
  "outbrain.com",
  "taboola.com",
  "bing.com",
  "bingads.microsoft.com",
  "ads.yahoo.com",
  "advertising.com",
  "adnxs.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "criteo.com",
  "media.net",
  "adsrvr.org",
  "adtechus.com",
  "adform.net",
  "adroll.com",
  "moatads.com",
  "chartbeat.com",
  "parsely.com",
  "newrelic.com",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
  "hotjar.com",
  "fullstory.com",
  "mouseflow.com",
  "crazyegg.com",
  "optimizely.com",
  "vwo.com",
  "abtasty.com",
  "convert.com",
  "unbounce.com",
  "intercom.io",
  "zendesk.com",
  "drift.com",
  "olark.com",
  "livechatinc.com",
  "uservoice.com",
  "helpscout.com",
  "freshdesk.com",
  "zoho.com",
  "salesforce.com",
  "marketo.com",
  "hubspot.com",
  "pardot.com",
  "eloqua.com",
  "act-on.com",
  "constantcontact.com",
  "mailchimp.com",
  "sendgrid.com",
  "mandrill.com",
  "postmarkapp.com",
  "sparkpost.com",
  "mailgun.com",
  "sendinblue.com",
  "getresponse.com",
  "aweber.com",
  "icontact.com",
  "verticalresponse.com",
  "benchmarkemail.com",
  "campaignmonitor.com",
  "drip.com",
  "klaviyo.com",
  "omnisend.com",
  "autopilot.com",
  "customer.io",
  "braze.com",
  "urbanairship.com",
  "onesignal.com",
  "pushcrew.com",
  "pushwoosh.com",
  "pushbullet.com",
  "pusher.com",
  "pubnub.com",
  "ably.com",
  "pusher.com",
  "stream.io",
  "getstream.io",
  "layer.com",
  "twilio.com",
  "nexmo.com",
  "plivo.com",
  "bandwidth.com",
  "sinch.com",
  "messagebird.com",
  "vonage.com",
  "ringcentral.com",
  "8x8.com",
  "zoom.us",
  "gotomeeting.com",
  "webex.com",
  "bluejeans.com",
  "jitsi.org",
  "whereby.com",
  "appear.in",
  "talky.io",
  "tokbox.com",
  "agora.io",
  "daily.co",
  "mux.com",
  "cloudflare.com",
  "fastly.com",
  "keycdn.com",
  "bunnycdn.com",
  "stackpath.com",
  "maxcdn.com",
  "cdnjs.com",
  "jsdelivr.com",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "ajax.googleapis.com",
  "ajax.aspnetcdn.com",
  "cdn.sstatic.net",
  "sstatic.net",
  "cdn.mathjax.org",
  "cdn.rawgit.com",
  "cdn.ckeditor.com",
  "cdn.tiny.cloud",
  "cdn.quilljs.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "unpkg.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
  "ajax.googleapis.com",
  "ajax.aspnetcdn.com",
  "cdn.sstatic.net",
  "sstatic.net",
  "cdn.mathjax.org",
  "cdn.rawgit.com",
  "cdn.ckeditor.com",
  "cdn.tiny.cloud",
  "cdn.quilljs.com",
];

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

/**
 * Convert AOM tree to XML
 */
export function aomToXml(node: Record<string, unknown>, indent = 0): string {
  const spaces = "  ".repeat(indent);
  const tagName = node.role || "node";
  const attributes: string[] = [];

  if (node.name && typeof node.name === "string") {
    attributes.push(`name="${escapeXml(node.name)}"`);
  }
  if (node.value && typeof node.value === "string") {
    attributes.push(`value="${escapeXml(node.value)}"`);
  }
  if (node.description && typeof node.description === "string") {
    attributes.push(`description="${escapeXml(node.description)}"`);
  }
  if (node.checked !== undefined) {
    attributes.push(`checked="${node.checked}"`);
  }
  if (node.selected !== undefined) {
    attributes.push(`selected="${node.selected}"`);
  }
  if (node.expanded !== undefined) {
    attributes.push(`expanded="${node.expanded}"`);
  }
  if (node.disabled !== undefined) {
    attributes.push(`disabled="${node.disabled}"`);
  }
  if (node.readonly !== undefined) {
    attributes.push(`readonly="${node.readonly}"`);
  }
  if (node.required !== undefined) {
    attributes.push(`required="${node.required}"`);
  }
  if (node.invalid !== undefined) {
    attributes.push(`invalid="${node.invalid}"`);
  }

  const attrsStr = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";
  const children = (
    Array.isArray(node.children) ? node.children : []
  ) as Record<string, unknown>[];

  if (children.length === 0) {
    return `${spaces}<${tagName}${attrsStr} />`;
  }

  let xml = `${spaces}<${tagName}${attrsStr}>\n`;
  for (const child of children) {
    xml += aomToXml(child, indent + 1) + "\n";
  }
  xml += `${spaces}</${tagName}>`;

  return xml;
}

/**
 * Escape XML special characters
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Extract AOM from page
 */
async function extractAOM(page: Page): Promise<string> {
  try {
    // Try to use Puppeteer's accessibility snapshot
    const snapshot = await page.accessibility.snapshot();
    if (snapshot) {
      // Convert SerializedAXNode to Record<string, unknown> for aomToXml
      const snapshotRecord = snapshot as unknown as Record<string, unknown>;
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<aom>\n${aomToXml(
        snapshotRecord,
        1
      )}\n</aom>`;
      return xml;
    }
  } catch {
    console.warn(
      "[scrape] Failed to get accessibility snapshot, falling back to DOM traversal"
    );
  }

  // Fallback: Build AOM from DOM
  const aom = (await page.evaluate((): Record<string, unknown> => {
    function buildAOMNode(element: Element): Record<string, unknown> {
      const node: Record<string, unknown> = {
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        name:
          element.getAttribute("aria-label") ||
          element.getAttribute("alt") ||
          (element as HTMLElement).innerText?.trim() ||
          undefined,
        value: (element as HTMLInputElement).value || undefined,
        description: element.getAttribute("aria-description") || undefined,
      };

      // Check ARIA states
      if (element.hasAttribute("aria-checked")) {
        node.checked = element.getAttribute("aria-checked") === "true";
      }
      if (element.hasAttribute("aria-selected")) {
        node.selected = element.getAttribute("aria-selected") === "true";
      }
      if (element.hasAttribute("aria-expanded")) {
        node.expanded = element.getAttribute("aria-expanded") === "true";
      }
      if (element.hasAttribute("aria-disabled")) {
        node.disabled = element.getAttribute("aria-disabled") === "true";
      }
      if (element.hasAttribute("aria-readonly")) {
        node.readonly = element.getAttribute("aria-readonly") === "true";
      }
      if (element.hasAttribute("aria-required")) {
        node.required = element.getAttribute("aria-required") === "true";
      }
      if (element.hasAttribute("aria-invalid")) {
        node.invalid = element.getAttribute("aria-invalid") === "true";
      }

      // Recursively process children
      const children: Record<string, unknown>[] = [];
      for (const child of Array.from(element.children)) {
        children.push(buildAOMNode(child));
      }
      if (children.length > 0) {
        node.children = children;
      }

      return node;
    }

    const root = document.documentElement;
    return buildAOMNode(root) as Record<string, unknown>;
  })) as Record<string, unknown>;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<aom>\n${aomToXml(
    aom,
    1
  )}\n</aom>`;
  return xml;
}

/**
 * Get JWT secret key from environment
 */
function getJwtSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Extract and validate encrypted JWT from Authorization header
 * Returns workspaceId, agentId, and conversationId from the token payload
 */
async function extractWorkspaceContextFromToken(req: express.Request): Promise<{
  workspaceId: string;
  agentId: string;
  conversationId: string;
}> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== "string") {
    throw unauthorized("Authorization header with Bearer token is required");
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw unauthorized(
      "Invalid Authorization header format. Expected: Bearer <token>"
    );
  }

  const encryptedToken = match[1];
  const secret = getJwtSecret();

  try {
    const { payload } = await jwtDecrypt(encryptedToken, secret, {
      issuer: "helpmaton",
      audience: "helpmaton-api",
    });

    // Extract required fields from payload
    const workspaceId = payload.workspaceId;
    const agentId = payload.agentId;
    const conversationId = payload.conversationId;

    if (
      typeof workspaceId !== "string" ||
      typeof agentId !== "string" ||
      typeof conversationId !== "string"
    ) {
      throw unauthorized(
        "Token payload must contain workspaceId, agentId, and conversationId as strings"
      );
    }

    return { workspaceId, agentId, conversationId };
  } catch (error) {
    console.error("[scrape] Error decrypting JWT token:", error);
    if (error && typeof error === "object" && "isBoom" in error) {
      throw error;
    }
    throw unauthorized("Invalid or expired encrypted token");
  }
}

/**
 * Setup resource blocking on page
 */
async function setupResourceBlocking(page: Page): Promise<void> {
  await page.setRequestInterception(true);

  page.on("request", (request: HTTPRequest) => {
    const resourceType = request.resourceType();
    const url = request.url();

    // Block images, CSS, fonts, media
    if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
      request.abort();
      return;
    }

    // Block subframes (iframes)
    if (resourceType === "subframe") {
      request.abort();
      return;
    }

    // Block tracker domains
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      if (TRACKER_DOMAINS.some((tracker) => hostname.includes(tracker))) {
        request.abort();
        return;
      }
    } catch {
      // Invalid URL, allow it through
    }

    request.continue();
  });
}

/**
 * Create Express app for scrape endpoint
 */
function createApp(): express.Application {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());

  app.post("/api/scrape", async (req, res, next) => {
    let browser: Browser | null = null;

    try {
      // Extract and validate encrypted JWT token
      const { workspaceId, agentId, conversationId } =
        await extractWorkspaceContextFromToken(req);

      // Get AWS request ID for context lookup
      const awsRequestId =
        req.headers["x-amzn-requestid"] ||
        req.headers["X-Amzn-Requestid"] ||
        req.headers["x-request-id"] ||
        req.headers["X-Request-Id"] ||
        req.apiGateway?.event?.requestContext?.requestId;

      // Get context for workspace credit transactions
      // The context is already augmented by handlingErrors wrapper with addWorkspaceCreditTransaction capability
      const context = getContextFromRequestId(
        Array.isArray(awsRequestId) ? awsRequestId[0] : awsRequestId
      );
      if (!context) {
        throw new Error(
          "Context not available for workspace credit transactions. Ensure the handler is wrapped with handlingErrors."
        );
      }

      // Verify context has the addWorkspaceCreditTransaction method (type guard)
      if (typeof context.addWorkspaceCreditTransaction !== "function") {
        throw new Error(
          "Context is not properly augmented with workspace credit transaction capability"
        );
      }

      const { url } = req.body;

      if (!url || typeof url !== "string") {
        throw badRequest("url is required and must be a string");
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        throw badRequest("url must be a valid URL");
      }

      // Get random proxy URL
      const proxyUrl = getRandomProxyUrl();
      const { server, username, password } = parseProxyUrl(proxyUrl);

      console.log(
        `[scrape] Using proxy: ${server} (username: ${
          username ? "***" : "none"
        })`
      );

      // Launch browser with proxy
      const executablePath =
        process.env.PUPPETEER_EXECUTABLE_PATH ||
        "/opt/chrome/chrome-linux-arm64/chrome";

      browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
          "--disable-gpu",
          `--proxy-server=${server}`,
        ],
      });

      const page = await browser.newPage();

      // Authenticate with proxy if credentials provided
      if (username && password) {
        await page.authenticate({ username, password });
      }

      // Setup resource blocking
      await setupResourceBlocking(page);

      // Navigate to URL and wait for client-side content
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      // Extract AOM
      const aomXml = await extractAOM(page);

      // Charge workspace credits (0.005 USD = 5000 millionths) only on success
      // Transaction will be committed at the end of the request if no error occurs
      // The context is already augmented by handlingErrors wrapper, so addWorkspaceCreditTransaction is available
      const scrapeCostMillionthUsd = 5000; // 0.005 USD
      context.addWorkspaceCreditTransaction({
        workspaceId,
        agentId,
        conversationId,
        source: "tool-execution",
        supplier: "openrouter", // Using openrouter as supplier for consistency
        tool_call: "scrape",
        description: `Web scraping: ${url}`,
        amountMillionthUsd: scrapeCostMillionthUsd,
      });

      // Return XML response
      res.setHeader("Content-Type", "application/xml");
      res.status(200).send(aomXml);
    } catch (err) {
      // Report server errors to Sentry before passing to error handler
      const boomed = boomify(err as Error);
      if (boomed.isServer) {
        console.error("[scrape] Server error:", boomed);
        Sentry.captureException(ensureError(err), {
          tags: {
            handler: "scrape-endpoint",
            method: req.method,
            path: req.path,
            statusCode: boomed.output.statusCode,
          },
          contexts: {
            request: {
              method: req.method,
              url: req.url,
              path: req.path,
            },
          },
        });
      }
      next(err);
    } finally {
      // Cleanup browser
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error("[scrape] Error closing browser:", closeError);
          // Report browser cleanup errors to Sentry
          Sentry.captureException(ensureError(closeError), {
            tags: {
              handler: "scrape-endpoint",
              operation: "browser-cleanup",
            },
          });
        }
      }

      // Flush Sentry events before request completes (critical for Lambda)
      try {
        await flushSentry();
      } catch (flushError) {
        console.error("[scrape] Error flushing Sentry:", flushError);
      }
    }
  });

  app.use(expressErrorHandler);

  return app;
}

let cachedHandler: APIGatewayProxyHandlerV2 | undefined;

const createHandler = async (): Promise<APIGatewayProxyHandlerV2> => {
  if (cachedHandler) {
    return cachedHandler;
  }

  try {
    const app = createApp();
    const handler = handlingErrors(
      serverlessExpress({
        app,
        respondWithErrors: true,
      })
    );
    cachedHandler = handler;
    return handler;
  } catch (error) {
    console.error("[scrape] Error creating app:", error);
    if (error instanceof Error) {
      console.error("[scrape] Error stack:", error.stack);
    }
    throw error;
  }
};

export const handler = adaptHttpHandler(
  async (...args: Parameters<APIGatewayProxyHandlerV2>) => {
    try {
      // createHandler() already wraps with handlingErrors, so we don't need to wrap again
      const h: APIGatewayProxyHandlerV2 = await createHandler();
      return (await h(...args)) as APIGatewayProxyResultV2;
    } catch (error) {
      console.error("[scrape] Error in handler:", error);
      if (error instanceof Error) {
        console.error("[scrape] Error stack:", error.stack);
      }
      throw error;
    }
  }
);
