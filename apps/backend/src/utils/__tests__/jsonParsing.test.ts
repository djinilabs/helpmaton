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

  it("parses JSON from code block with leading and trailing text", () => {
    const payload = { summary: "Done", memory_operations: [] };
    const input =
      "Here is the JSON:\n\n```json\n" +
      JSON.stringify(payload) +
      "\n```\n\nHope that helps!";
    const result = parseJsonWithFallback<typeof payload>(input);
    expect(result).toEqual(payload);
  });

  it("parses JSON from generic code block with surrounding text", () => {
    const payload = { a: 1, b: 2 };
    const input =
      "Result:\n```\n" + JSON.stringify(payload) + "\n```\nDone.";
    const result = parseJsonWithFallback<typeof payload>(input);
    expect(result).toEqual(payload);
  });
});
