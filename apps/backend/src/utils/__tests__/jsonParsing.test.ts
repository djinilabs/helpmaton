import { describe, expect, it } from "vitest";

import { parseJsonWithFallback, stripJsonCodeFences } from "../jsonParsing";

describe("jsonParsing utilities", () => {
  it("strips json code fences", () => {
    const input = '```json\n{"a": 1}\n```';
    expect(stripJsonCodeFences(input)).toBe('{"a": 1}');
  });

  it("strips generic code fences", () => {
    const input = '```\n{"a": 1}\n```';
    expect(stripJsonCodeFences(input)).toBe('{"a": 1}');
  });

  it("parses valid JSON with no extra text", () => {
    const result = parseJsonWithFallback<{ a: number }>('{"a": 1}');
    expect(result).toEqual({ a: 1 });
  });

  it("extracts JSON from surrounding text", () => {
    const result = parseJsonWithFallback<{ ok: boolean }>(
      'Here is data: {"ok": true} thanks!',
    );
    expect(result).toEqual({ ok: true });
  });

  it("parses nested objects with escaped characters", () => {
    const result = parseJsonWithFallback<{ nested: { value: string } }>(
      'Prefix {"nested": {"value": "quote: \\"ok\\""}} suffix',
    );
    expect(result).toEqual({ nested: { value: 'quote: "ok"' } });
  });

  it("throws when no JSON is available", () => {
    expect(() => parseJsonWithFallback("{oops")).toThrow();
  });
});
