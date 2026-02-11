import { describe, expect, it } from "vitest";

import { shouldAliasBeforeIdentify } from "../../utils/posthogIdentity";

describe("posthogIdentity", () => {
  describe("shouldAliasBeforeIdentify", () => {
    it("returns true when current id is anonymous and new user id is provided", () => {
      expect(shouldAliasBeforeIdentify("abc-anonymous-123", "uid-1")).toBe(true);
    });

    it("returns false when current id already equals user/ prefix id", () => {
      expect(shouldAliasBeforeIdentify("user/uid-1", "uid-1")).toBe(false);
    });

    it("returns false when current id is null", () => {
      expect(shouldAliasBeforeIdentify(null, "uid-1")).toBe(false);
    });

    it("returns false when current id is empty string", () => {
      expect(shouldAliasBeforeIdentify("", "uid-1")).toBe(false);
    });

    it("returns true when current id is uuid-like anonymous (typical PostHog anonymous id)", () => {
      expect(
        shouldAliasBeforeIdentify("018e4590-2a3b-7000-8000-1a2b3c4d5e6f", "uid-1")
      ).toBe(true);
    });

    it("returns false when current id is different identified user (no alias between user/* ids)", () => {
      expect(shouldAliasBeforeIdentify("user/uid-other", "uid-1")).toBe(false);
    });
  });
});
