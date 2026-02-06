import { boomify } from "@hapi/boom";
import serverlessExpress from "@vendia/serverless-express";
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import express from "express";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-core is installed in container image
import type { Browser, Page } from "puppeteer-core";

import { database } from "../../tables";
import { extractAOM, aomToXml, escapeXml } from "../../utils/aomUtils";
import {
  waitForCaptchaElements,
  solveCaptchas,
} from "../../utils/captchaUtils";
import { InsufficientCreditsError } from "../../utils/creditErrors";
import {
  reserveCredits,
  type CreditReservation,
} from "../../utils/creditManagement";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import {
  getRandomProxyUrl,
  getRandomProxyUrlExcluding,
  parseProxyUrl,
} from "../../utils/proxyUtils";
import { launchBrowser } from "../../utils/puppeteerBrowser";
// delay is still imported for small safety ticks, but used sparingly
import { delay } from "../../utils/puppeteerContentLoading";
import { setupResourceBlocking } from "../../utils/puppeteerResourceBlocking";
import { ensureError, flushSentry, initSentry } from "../../utils/sentry";
import { trackBusinessEvent } from "../../utils/tracking";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";
import { validateBody } from "../utils/bodyValidation";
import { expressErrorHandler } from "../utils/errorHandler";
import { extractWorkspaceContextFromToken } from "../utils/jwtUtils";
import { scrapeRequestSchema } from "../utils/schemas/requestSchemas";

import {
  BLOCK_PAGE_ERROR_MESSAGE,
  getRefererForUrl,
  isBlockPageContent,
  isScraperRelatedError,
  isStrictDomain,
  normalizeUrlForStrictDomain,
} from "./scrapeHelpers";

initSentry();

// Re-export for backward compatibility
export { parseProxyUrl, getRandomProxyUrl, aomToXml, escapeXml };

/**
 * Smart Wait Strategy for Reddit
 * Watches for text stability and component upgrade (Hydration)
 */
async function waitForRedditHydration(page: Page) {
  return page.evaluate(async () => {
    return new Promise<void>((resolve) => {
      let lastLength = document.body.innerText.length;
      let stableCount = 0;

      // Check DOM state every 100ms
      const interval = setInterval(() => {
        const currentLength = document.body.innerText.length;

        // Check if Reddit's custom web components are present
        const hasApp = document.querySelector("shreddit-app") !== null;
        const hasPost = document.querySelector("shreddit-post") !== null;
        const hasComments = document.querySelector("shreddit-comment") !== null;

        // We consider it "bootstrapped" if the app shell exists
        const isBootstrapped = hasApp || hasPost || hasComments;

        // Condition: App is running AND text exists AND text hasn't changed recently
        if (
          isBootstrapped &&
          currentLength > 500 &&
          currentLength === lastLength
        ) {
          stableCount++;
        } else {
          stableCount = 0;
          lastLength = currentLength;
        }

        // If stable for 500ms (5 ticks), we are hydrated
        if (stableCount >= 5) {
          clearInterval(interval);
          resolve();
        }
      }, 100);

      // Hard timeout: Resolve anyway after 10s to prevent hanging
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, 10000);
    });
  });
}

/**
 * Create Express app for scrape endpoint
 */
export function createApp(): express.Application {
  const app = express();
  app.set("etag", false);
  app.set("trust proxy", true);
  app.use(express.json());

  app.post("/api/scrape", async (req, res, next) => {
    let browser: Browser | null = null;
    let reservation: CreditReservation | null = null;
    let context: ReturnType<typeof getContextFromRequestId> = undefined;

    try {
      // --- 1. Context & Auth Setup ---
      const { workspaceId, agentId, conversationId } =
        await extractWorkspaceContextFromToken(req);

      const awsRequestIdRaw =
        req.headers["x-amzn-requestid"] ||
        req.headers["X-Amzn-Requestid"] ||
        req.headers["x-request-id"] ||
        req.headers["X-Request-Id"] ||
        req.apiGateway?.event?.requestContext?.requestId;
      const awsRequestId = Array.isArray(awsRequestIdRaw)
        ? awsRequestIdRaw[0]
        : awsRequestIdRaw;

      context = getContextFromRequestId(awsRequestId);
      if (
        !context ||
        typeof context.addWorkspaceCreditTransaction !== "function"
      ) {
        throw new Error("Context not properly configured for credits.");
      }

      // Validate request body
      const body = validateBody(req.body, scrapeRequestSchema);
      const { url } = body;
      const normalizedUrl = normalizeUrlForStrictDomain(url);
      const strictDomain = isStrictDomain(normalizedUrl);

      // --- 2. Credit Reservation ---
      const scrapeCostNanoUsd = 5_000_000;
      const db = await database();
      reservation = await reserveCredits(
        db,
        workspaceId,
        scrapeCostNanoUsd,
        3,
        false,
        context,
        "scrape",
        "scrape",
        agentId,
        conversationId,
      );

      console.log(`[scrape] Credits reserved. Proxy selection...`);

      let firstAttemptProxyUrl: string | undefined;

      for (let attempt = 1; attempt <= 2; attempt++) {
        console.log(`[scrape] Attempt ${attempt}/2`);

        if (attempt === 2) {
          console.log(
            "[scrape] Retrying with different proxy after block detected."
          );
        }

        // --- 3. Browser Launch ---
        const proxyUrl =
          attempt === 1
            ? getRandomProxyUrl()
            : getRandomProxyUrlExcluding(firstAttemptProxyUrl);
        if (attempt === 1) {
          firstAttemptProxyUrl = proxyUrl;
        }
        const { server, username, password } = parseProxyUrl(proxyUrl);

        browser = await launchBrowser(server);
        const page = await browser.newPage();

        // Stable desktop viewport in all environments (reduces fingerprinting)
        await page.setViewport({ width: 1920, height: 1080 });

        // Realistic headers to reduce WAF/bot detection
        const referer = getRefererForUrl(normalizedUrl);
        await page.setExtraHTTPHeaders({
          "Accept-Language": "en-US,en;q=0.9",
          ...(referer ? { Referer: referer } : {}),
        });

        if (username && password) {
          await page.authenticate({ username, password });
        }

        // Skip resource blocking for strict domains so page loads like a real browser
        if (!strictDomain) {
          await setupResourceBlocking(page);
        }

        // --- 4. Optimized Navigation & Waiting ---
        if (strictDomain) {
          await delay(1000 + Math.random() * 1000);
        }

        console.log(`[scrape] Navigating to ${normalizedUrl}...`);

        await page.goto(normalizedUrl, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        // Reddit-specific wait: only for Reddit URLs to avoid 15s timeout on other sites
        if (strictDomain) {
          console.log("[scrape] Waiting for Reddit hydration...");
          try {
            await page.waitForSelector(
              'shreddit-post, shreddit-comment, [data-testid="post-container"], .Post',
              { timeout: 15000 },
            );
            await waitForRedditHydration(page);
          } catch (error) {
            console.warn(
              "[scrape] Hydration wait timed out or structure differ, proceeding with fallback.",
              error,
            );
          }
        }

        // --- 5. Smart Scrolling ---
        console.log("[scrape] Triggering lazy content load...");

        const prevHeight = await page.evaluate(() => document.body.scrollHeight);
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight)
        );

        try {
          await page.waitForFunction(
            (h) => document.body.scrollHeight > h,
            { timeout: 3000, polling: 500 },
            prevHeight,
          );
        } catch (error) {
          console.warn(
            "[scrape] Height didn't change, page might be fully loaded already.",
            error,
          );
        }

        await delay(1000);
        await page.evaluate(() => window.scrollTo(0, 0));

        // --- 6. Captcha Handling ---
        const potentialCaptcha = await page.$(
          'iframe[src*="captcha"], #captcha, [data-testid="captcha"]',
        );
        if (potentialCaptcha) {
          console.log(
            "[scrape] Potential captcha detected, initiating solver...",
          );
          await waitForCaptchaElements(page);
          await solveCaptchas(page);
        }

        // --- 7. Extraction & block-page detection ---
        const aomXml = await extractAOM(page);

        if (isBlockPageContent(aomXml)) {
          await browser.close();
          browser = null;
          if (attempt === 2) {
            throw new Error(BLOCK_PAGE_ERROR_MESSAGE);
          }
          continue;
        }

        console.log("[scrape] Success.");

        trackBusinessEvent(
          "scrape",
          "executed",
          {
            workspace_id: workspaceId,
            agent_id: agentId,
          },
          undefined,
        );

        res.setHeader("Content-Type", "application/xml");
        res.status(200).send(aomXml);
        return;
      }
    } catch (err) {
      // --- Error Handling ---
      if (err instanceof InsufficientCreditsError) {
        const boomed = boomify(err, { statusCode: err.statusCode });
        next(boomed);
        return;
      }

      // Do not refund on tool failure; consume reservation instead
      if (
        reservation &&
        reservation.reservationId !== "byok" &&
        reservation.reservationId !== "deduction-disabled" &&
        context
      ) {
        try {
          const db = await database();
          await db["credit-reservations"].delete(
            `credit-reservations/${reservation.reservationId}`,
          );
          console.log("[scrape] Removed reservation after error.");
        } catch (cleanupError) {
          console.error("[scrape] Reservation cleanup failed:", cleanupError);
        }
      }

      const boomed = boomify(ensureError(err));
      const scraperRelated = isScraperRelatedError(err);
      if (scraperRelated) {
        req.skipSentryCapture = true;
      }
      if (boomed.isServer) {
        console.error(
          scraperRelated
            ? "[scrape] Scraper/website error (not reported to Sentry):"
            : "[scrape] Server error:",
          boomed
        );
      }
      next(boomed);
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error("[scrape] Browser close error:", closeError);
        }
      }
      await flushSentry().catch(console.error);
    }
  });

  app.use(expressErrorHandler);
  return app;
}

// ... Boilerplate for Lambda Handler ...

let cachedHandler: APIGatewayProxyHandlerV2 | undefined;

const createHandler = async (): Promise<APIGatewayProxyHandlerV2> => {
  if (cachedHandler) return cachedHandler;
  try {
    const app = createApp();
    cachedHandler = handlingErrors(
      serverlessExpress({ app, respondWithErrors: true }),
    );
    return cachedHandler;
  } catch (error) {
    console.error("[scrape] App creation failed:", error);
    throw error;
  }
};

export const handler = adaptHttpHandler(
  async (...args: Parameters<APIGatewayProxyHandlerV2>) => {
    const h = await createHandler();
    return (await h(...args)) as APIGatewayProxyResultV2;
  },
);
