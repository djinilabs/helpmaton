import { describe, expect, it } from "vitest";

import { isAuthenticationError } from "../authenticationErrorDetection";

describe("isAuthenticationError", () => {
  it("detects authentication phrases in error messages", () => {
    const error = new Error("Invalid API key provided");
    expect(isAuthenticationError(error)).toBe(true);
  });

  it("detects authentication status codes on Error instances", () => {
    const error = new Error("Request failed");
    (error as { statusCode?: number }).statusCode = 403;
    expect(isAuthenticationError(error)).toBe(true);
  });

  it("detects authentication errors in nested causes", () => {
    const cause = new Error("Unauthorized");
    const error = new Error("Wrapped", { cause });
    expect(isAuthenticationError(error)).toBe(true);
  });

  it("detects authentication errors in data payloads", () => {
    const error = {
      data: {
        error: {
          message: "Authentication required",
        },
      },
    };
    expect(isAuthenticationError(error)).toBe(true);
  });

  it("detects authentication errors in JSON bodies", () => {
    const error = {
      body: JSON.stringify({ error: "Forbidden" }),
    };
    expect(isAuthenticationError(error)).toBe(true);
  });

  it("returns false for non-authentication errors", () => {
    const error = new Error("Something else went wrong");
    expect(isAuthenticationError(error)).toBe(false);
  });
});
