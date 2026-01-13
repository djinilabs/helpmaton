import { describe, it, expect } from "vitest";

import {
  isRecoverableError,
  isAuthenticationError,
  calculateBackoffDelay,
} from "../errors";

describe("Google Drive Error Utilities", () => {
  describe("isRecoverableError", () => {
    it("should return true for HTTP 429", () => {
      expect(isRecoverableError(429)).toBe(true);
    });

    it("should return true for HTTP 503", () => {
      expect(isRecoverableError(503)).toBe(true);
    });

    it("should return false for other status codes", () => {
      expect(isRecoverableError(200)).toBe(false);
      expect(isRecoverableError(400)).toBe(false);
      expect(isRecoverableError(500)).toBe(false);
    });
  });

  describe("isAuthenticationError", () => {
    it("should return true for HTTP 401", () => {
      expect(isAuthenticationError(401)).toBe(true);
    });

    it("should return true for HTTP 403", () => {
      expect(isAuthenticationError(403)).toBe(true);
    });

    it("should return false for other status codes", () => {
      expect(isAuthenticationError(200)).toBe(false);
      expect(isAuthenticationError(400)).toBe(false);
      expect(isAuthenticationError(500)).toBe(false);
    });
  });

  describe("calculateBackoffDelay", () => {
    it("should calculate exponential backoff with jitter", () => {
      const delay0 = calculateBackoffDelay(0);
      const delay1 = calculateBackoffDelay(1);
      const delay2 = calculateBackoffDelay(2);

      expect(delay0).toBeGreaterThan(0);
      expect(delay1).toBeGreaterThan(delay0);
      expect(delay2).toBeGreaterThan(delay1);
    });

    it("should respect max delay", () => {
      const maxDelay = 8000;
      const delay = calculateBackoffDelay(10, 1000, maxDelay);

      expect(delay).toBeLessThanOrEqual(maxDelay);
    });

    it("should include jitter", () => {
      const delays = Array.from({ length: 10 }, () =>
        calculateBackoffDelay(1, 1000, 8000)
      );

      // All delays should be different due to jitter
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });
  });
});
