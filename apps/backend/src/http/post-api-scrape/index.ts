import { tmpdir } from "os";
import { join } from "path";

import { badRequest, boomify } from "@hapi/boom";
import serverlessExpress from "@vendia/serverless-express";
import type {
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import express from "express";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - puppeteer-core is installed in container image
import type { Browser } from "puppeteer-core";

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
import { delay } from "../../utils/puppeteerContentLoading";
import { setupResourceBlocking } from "../../utils/puppeteerResourceBlocking";
import { ensureError, flushSentry, Sentry } from "../../utils/sentry";
import { getContextFromRequestId } from "../../utils/workspaceCreditContext";
import { expressErrorHandler } from "../utils/errorHandler";
import { extractWorkspaceContextFromToken } from "../utils/jwtUtils";

// Re-export for backward compatibility with existing tests
export { parseProxyUrl, getRandomProxyUrl, aomToXml, escapeXml };

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
      // Extract and validate encrypted JWT token
      const { workspaceId, agentId, conversationId } =
        await extractWorkspaceContextFromToken(req);

      // Get AWS request ID for context lookup
      const awsRequestIdRaw =
        req.headers["x-amzn-requestid"] ||
        req.headers["X-Amzn-Requestid"] ||
        req.headers["x-request-id"] ||
        req.headers["X-Request-Id"] ||
        req.apiGateway?.event?.requestContext?.requestId;
      const awsRequestId = Array.isArray(awsRequestIdRaw)
        ? awsRequestIdRaw[0]
        : awsRequestIdRaw;

      // Get context for workspace credit transactions
      context = getContextFromRequestId(awsRequestId);
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

      // Validate URL length (max 2048 characters to prevent abuse)
      if (url.length > 2048) {
        throw badRequest("url must be 2048 characters or less");
      }

      // Validate URL format
      try {
        new URL(url);
      } catch {
        throw badRequest("url must be a valid URL");
      }

      // Reserve credits upfront (0.005 USD = 5000 millionths)
      const scrapeCostMillionthUsd = 5000; // 0.005 USD
      const db = await database();
      reservation = await reserveCredits(
        db,
        workspaceId,
        scrapeCostMillionthUsd,
        3, // maxRetries
        false, // usesByok
        context,
        "scrape", // provider (scraping tool)
        "scrape", // modelName (using tool name as model)
        agentId,
        conversationId
      );

      console.log("[scrape] Reserved credits:", {
        workspaceId,
        reservationId: reservation.reservationId,
        reservedAmount: reservation.reservedAmount,
      });

      // Get random proxy URL
      const proxyUrl = getRandomProxyUrl();
      const { server, username, password } = parseProxyUrl(proxyUrl);

      console.log(
        `[scrape] Using proxy: ${server} (username: ${
          username ? "***" : "none"
        })`
      );

      // Launch browser with proxy
      browser = await launchBrowser(server);

      const page = await browser.newPage();

      // Set realistic viewport to appear more human-like
      // Viewport is already set via chromium.defaultViewport in Lambda, but set it for local dev
      if (!process.env.LAMBDA_TASK_ROOT) {
        await page.setViewport({ width: 1920, height: 1080 });
      }

      // Authenticate with proxy if credentials provided
      if (username && password) {
        await page.authenticate({ username, password });
      }

      // Setup resource blocking to optimize performance and privacy
      await setupResourceBlocking(page);

      // Navigate to URL and wait for client-side content
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: 300000, // 5 minutes timeout
      });

      // Wait for content to load BEFORE checking for CAPTCHAs or extracting AOM
      console.log("[scrape] Waiting for content to load...");
      await delay(3000);

      // Wait for substantial content to appear (not just navigation)
      try {
        await page
          .waitForFunction(
            () => {
              const bodyText = document.body?.innerText || "";
              const hasSubstantialContent = bodyText.length > 1000;

              const hasCommentContent =
                document.querySelector("[data-testid*='comment']") !== null ||
                document.querySelector("[class*='Comment']") !== null ||
                document.querySelector("[class*='comment']") !== null ||
                document.querySelector("shreddit-comment") !== null ||
                document.querySelector(
                  "faceplate-tracker[source='comments']"
                ) !== null;

              const hasPostContent =
                document.querySelector("[data-testid*='post']") !== null ||
                document.querySelector("[class*='Post']") !== null ||
                document.querySelector("[class*='post']") !== null ||
                document.querySelector("shreddit-post") !== null;

              const hasRedditStructure =
                document.querySelector("shreddit-app") !== null &&
                (hasCommentContent || hasPostContent || hasSubstantialContent);

              return hasSubstantialContent || hasRedditStructure;
            },
            { timeout: 20000 }
          )
          .catch(() => {
            console.warn("[scrape] Content wait timeout, proceeding anyway");
          });
      } catch {
        // Continue if waiting fails
      }

      // Additional wait for JavaScript-heavy sites
      await delay(5000);
      await delay(5000);

      // Scroll page multiple times to trigger lazy-loaded content
      console.log("[scrape] Scrolling to trigger lazy-loaded content...");
      for (let i = 0; i < 3; i++) {
        await page.evaluate((scrollFraction) => {
          window.scrollTo(0, (document.body.scrollHeight * scrollFraction) / 3);
        }, i + 1);
        await delay(1500);
      }

      // Scroll back to top
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await delay(1000);

      // Wait for async CAPTCHA elements to load
      await waitForCaptchaElements(page);

      // Attempt to solve CAPTCHAs if API key is available
      await solveCaptchas(page);

      // Take a screenshot for debugging right before AOM extraction
      try {
        const screenshotPath = join(tmpdir(), `scrape-debug-${Date.now()}.png`);

        const pageDimensions = await page.evaluate(() => {
          return {
            width: Math.max(
              document.body.scrollWidth,
              document.body.offsetWidth,
              document.documentElement.clientWidth,
              document.documentElement.scrollWidth,
              document.documentElement.offsetWidth
            ),
            height: Math.max(
              document.body.scrollHeight,
              document.body.offsetHeight,
              document.documentElement.clientHeight,
              document.documentElement.scrollHeight,
              document.documentElement.offsetHeight
            ),
          };
        });

        console.log(
          `[scrape] Page dimensions: ${pageDimensions.width}x${pageDimensions.height}`
        );

        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
          captureBeyondViewport: true,
        });
        console.log(`[scrape] Debug screenshot saved to: ${screenshotPath}`);
      } catch (screenshotError) {
        console.warn(
          "[scrape] Failed to take debug screenshot:",
          screenshotError
        );
      }

      // Extract AOM
      const aomXml = await extractAOM(page);

      console.log("[scrape] Request succeeded, keeping credit reservation:", {
        workspaceId,
        reservationId: reservation?.reservationId,
      });

      // Return XML response
      res.setHeader("Content-Type", "application/xml");
      res.status(200).send(aomXml);
    } catch (err) {
      // Handle InsufficientCreditsError
      if (err instanceof InsufficientCreditsError) {
        const boomed = boomify(err, { statusCode: err.statusCode });
        console.error("[scrape] Insufficient credits error:", {
          workspaceId: err.workspaceId,
          required: err.required,
          available: err.available,
          currency: err.currency,
        });
        next(boomed);
        return;
      }

      // Refund reserved credits if request failed
      if (
        reservation &&
        reservation.reservationId !== "byok" &&
        reservation.reservationId !== "deduction-disabled" &&
        context
      ) {
        try {
          const db = await database();
          await refundReservation(db, reservation.reservationId, context);
          console.log("[scrape] Refunded credits due to error:", {
            reservationId: reservation.reservationId,
          });
        } catch (refundError) {
          console.error("[scrape] Error refunding credits:", refundError);
        }
      }

      // Report server errors to Sentry
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
          contexts: {
            request: {
              method: req.method,
              url: req.url,
              path: req.path,
            },
          },
        });
      }
      next(boomed);
    } finally {
      // Cleanup browser
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error("[scrape] Error closing browser:", closeError);
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
