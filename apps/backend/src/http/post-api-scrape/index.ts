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
  refundReservation,
  reserveCredits,
  type CreditReservation,
} from "../../utils/creditManagement";
import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { getRandomProxyUrl, parseProxyUrl } from "../../utils/proxyUtils";
import { launchBrowser } from "../../utils/puppeteerBrowser";
// delay is still imported for small safety ticks, but used sparingly
import { delay } from "../../utils/puppeteerContentLoading";
import { setupResourceBlocking } from "../../utils/puppeteerResourceBlocking";
import { ensureError, flushSentry, Sentry } from "../../utils/sentry";
import { trackBusinessEvent } from "../../utils/tracking";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";
import { validateBody } from "../utils/bodyValidation";
import { expressErrorHandler } from "../utils/errorHandler";
import { extractWorkspaceContextFromToken } from "../utils/jwtUtils";
import { scrapeRequestSchema } from "../utils/schemas/requestSchemas";

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
function createApp(): express.Application {
  const app = express();
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

      // --- 2. Credit Reservation ---
      const scrapeCostMillionthUsd = 5000;
      const db = await database();
      reservation = await reserveCredits(
        db,
        workspaceId,
        scrapeCostMillionthUsd,
        3,
        false,
        context,
        "scrape",
        "scrape",
        agentId,
        conversationId
      );

      console.log(`[scrape] Credits reserved. Proxy selection...`);

      // --- 3. Browser Launch ---
      const proxyUrl = getRandomProxyUrl();
      const { server, username, password } = parseProxyUrl(proxyUrl);

      // Note: Ensure your launchBrowser utilizes process.env.PUPPETEER_EXECUTABLE_PATH
      browser = await launchBrowser(server);
      const page = await browser.newPage();

      // Viewport setup (Lambda vs Local)
      if (!process.env.LAMBDA_TASK_ROOT) {
        await page.setViewport({ width: 1920, height: 1080 });
      }

      if (username && password) {
        await page.authenticate({ username, password });
      }

      await setupResourceBlocking(page);

      // --- 4. Optimized Navigation & Waiting ---

      console.log(`[scrape] Navigating to ${url}...`);

      // A. Fast Navigation: Don't wait for network idle here, it's too slow for Reddit
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // B. Smart Wait: Detect Reddit Hydration
      console.log("[scrape] Waiting for Reddit hydration...");
      try {
        // Step 1: Wait for structural indicators (React/Lit components)
        await page.waitForSelector(
          'shreddit-post, shreddit-comment, [data-testid="post-container"], .Post',
          { timeout: 15000 }
        );

        // Step 2: Wait for text length to stabilize
        await waitForRedditHydration(page);
      } catch (error) {
        console.warn(
          "[scrape] Hydration wait timed out or structure differ, proceeding with fallback.",
          error
        );
      }

      // --- 5. Smart Scrolling ---
      // Instead of a 5s loop, trigger lazy load and wait for network reaction
      console.log("[scrape] Triggering lazy content load...");

      const prevHeight = await page.evaluate(() => document.body.scrollHeight);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      // Wait briefly for new content (height change) OR network idle
      try {
        await page.waitForFunction(
          (h) => document.body.scrollHeight > h,
          { timeout: 3000, polling: 500 },
          prevHeight
        );
      } catch (error) {
        // If height didn't change, page might be fully loaded already
        console.warn(
          "[scrape] Height didn't change, page might be fully loaded already.",
          error
        );
      }

      // Small safety tick for final rendering
      await delay(1000);

      // Scroll back up for clean screenshot/parsing
      await page.evaluate(() => window.scrollTo(0, 0));

      // --- 6. Captcha Handling ---
      // Check for captcha frames quickly
      const potentialCaptcha = await page.$(
        'iframe[src*="captcha"], #captcha, [data-testid="captcha"]'
      );
      if (potentialCaptcha) {
        console.log(
          "[scrape] Potential captcha detected, initiating solver..."
        );
        await waitForCaptchaElements(page);
        await solveCaptchas(page);
      }

      // --- 7. Extraction ---
      const aomXml = await extractAOM(page);

      console.log("[scrape] Success.");

      // Track scrape execution
      trackBusinessEvent(
        "scrape",
        "executed",
        {
          workspace_id: workspaceId,
          agent_id: agentId,
        },
        undefined // Scrape uses token auth, no user request context
      );

      res.setHeader("Content-Type", "application/xml");
      res.status(200).send(aomXml);
    } catch (err) {
      // --- Error Handling ---
      if (err instanceof InsufficientCreditsError) {
        const boomed = boomify(err, { statusCode: err.statusCode });
        next(boomed);
        return;
      }

      // Refund logic
      if (
        reservation &&
        reservation.reservationId !== "byok" &&
        reservation.reservationId !== "deduction-disabled" &&
        context
      ) {
        try {
          const db = await database();
          await refundReservation(db, reservation.reservationId, context);
          console.log("[scrape] Refunded credits.");
        } catch (refundError) {
          console.error("[scrape] Refund failed:", refundError);
        }
      }

      const boomed = boomify(ensureError(err));
      if (boomed.isServer) {
        console.error("[scrape] Server error:", boomed);
        Sentry.captureException(ensureError(err), {
          tags: {
            handler: "scrape-endpoint",
            method: req.method,
            path: req.path,
            statusCode: boomed.output.statusCode,
          },
        });
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
      serverlessExpress({ app, respondWithErrors: true })
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
  }
);
