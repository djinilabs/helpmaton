import type { Request, Response, NextFunction } from "express";

import { resetPostHogRequestContext } from "../../utils/posthog";

/**
 * Resets PostHog user identification at the start of every HTTP request.
 * Ensures events in this request are never attributed to a previous request's user
 * when the same process (e.g. Lambda container) handles multiple requests.
 * Mount this as early as possible in the middleware chain.
 */
export function posthogResetMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction
): void {
  resetPostHogRequestContext();
  next();
}
