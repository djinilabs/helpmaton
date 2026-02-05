import { describe, it, expect } from "vitest";

import { parseLimitParam } from "../paginationParams";

describe("parseLimitParam", () => {
  it("returns default when value is undefined", () => {
    expect(parseLimitParam(undefined)).toBe(50);
  });

  it("returns default when value is null", () => {
    expect(parseLimitParam(null)).toBe(50);
  });

  it("returns default when value is not a string", () => {
    expect(parseLimitParam(123)).toBe(50);
    expect(parseLimitParam({})).toBe(50);
  });

  it("returns default when value is invalid string (NaN)", () => {
    expect(parseLimitParam("abc")).toBe(50);
    expect(parseLimitParam("")).toBe(50);
  });

  it("clamps to 1 when value is below 1", () => {
    expect(parseLimitParam("0")).toBe(1);
    expect(parseLimitParam("-5")).toBe(1);
  });

  it("clamps to max (100) when value is above max", () => {
    expect(parseLimitParam("200")).toBe(100);
    expect(parseLimitParam("999")).toBe(100);
  });

  it("returns parsed value when within range", () => {
    expect(parseLimitParam("1")).toBe(1);
    expect(parseLimitParam("50")).toBe(50);
    expect(parseLimitParam("100")).toBe(100);
    expect(parseLimitParam("25")).toBe(25);
  });

  it("respects custom default and max options", () => {
    expect(parseLimitParam(undefined, { default: 20, max: 50 })).toBe(20);
    expect(parseLimitParam("100", { default: 20, max: 50 })).toBe(50);
    expect(parseLimitParam("30", { default: 20, max: 50 })).toBe(30);
  });
});
