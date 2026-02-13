import { describe, expect, it } from "vitest";

import { shouldShowTrialCreditHint } from "../workspaceDetailUtils";

describe("workspaceDetailUtils", () => {
  describe("shouldShowTrialCreditHint", () => {
    it("returns true when balance is 0, canEdit, free plan, and exactly one workspace", () => {
      expect(
        shouldShowTrialCreditHint(0, true, true, 1)
      ).toBe(true);
    });

    it("returns false when user has more than one workspace", () => {
      expect(
        shouldShowTrialCreditHint(0, true, true, 2)
      ).toBe(false);
      expect(
        shouldShowTrialCreditHint(0, true, true, 3)
      ).toBe(false);
    });

    it("returns false when user has paid plan (not free)", () => {
      expect(
        shouldShowTrialCreditHint(0, true, false, 1)
      ).toBe(false);
    });

    it("returns false when balance is not zero", () => {
      expect(
        shouldShowTrialCreditHint(1, true, true, 1)
      ).toBe(false);
    });

    it("returns false when user cannot edit", () => {
      expect(
        shouldShowTrialCreditHint(0, false, true, 1)
      ).toBe(false);
    });

    it("returns false when user has zero workspaces", () => {
      expect(
        shouldShowTrialCreditHint(0, true, true, 0)
      ).toBe(false);
    });
  });
});
