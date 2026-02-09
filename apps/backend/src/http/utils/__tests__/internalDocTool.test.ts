import { describe, expect, it } from "vitest";

import {
  INTERNAL_DOCS_CONTENT,
  INTERNAL_DOCS_INDEX,
  getInternalDocsIndexForPrompt,
} from "../../../utils/internalDocs";
import {
  executeReadInternalDoc,
  MAX_ATTEMPTS_ERROR,
  normalizeInternalDocId,
  type ReadInternalDocState,
} from "../internalDocTool";

describe("normalizeInternalDocId", () => {
  it("lowercases and strips .md suffix", () => {
    expect(normalizeInternalDocId("Getting-Started.MD")).toBe("getting-started");
  });
  it("replaces underscores with hyphens", () => {
    expect(normalizeInternalDocId("getting_started")).toBe("getting-started");
  });
  it("trims whitespace", () => {
    expect(normalizeInternalDocId("  getting-started  ")).toBe("getting-started");
  });
});

describe("internalDocTool", () => {
  it("returns content for a valid doc id", async () => {
    const state: ReadInternalDocState = { callCount: 0 };
    const firstId = INTERNAL_DOCS_INDEX[0]?.id;
    expect(firstId).toBeDefined();
    const result = await executeReadInternalDoc(state, firstId!);
    expect(typeof result).toBe("string");
    expect(result.startsWith("#")).toBe(true);
    expect(result).not.toContain('"error"');
  });

  it("returns Document not found error for unknown doc id with validIds", async () => {
    const state: ReadInternalDocState = { callCount: 0 };
    const result = await executeReadInternalDoc(state, "nonexistent-doc-id-12345");
    const parsed = JSON.parse(result) as {
      error: string;
      docId: string;
      hint: string;
      validIds?: string[];
    };
    expect(parsed.error).toBe("Document not found");
    expect(parsed.docId).toBe("nonexistent-doc-id-12345");
    expect(parsed.hint).toContain("internal docs index");
    expect(Array.isArray(parsed.validIds)).toBe(true);
    expect(parsed.validIds).toContain("getting-started");
  });

  it("returns Document not found for empty doc id", async () => {
    const state: ReadInternalDocState = { callCount: 0 };
    const result = await executeReadInternalDoc(state, "   ");
    const parsed = JSON.parse(result) as { error: string };
    expect(parsed.error).toBe("Document not found");
  });

  it("after 3 calls, 4th call returns max attempts error", async () => {
    const state: ReadInternalDocState = { callCount: 0 };
    const validId = Object.keys(INTERNAL_DOCS_CONTENT)[0];
    expect(validId).toBeDefined();

    await executeReadInternalDoc(state, validId!);
    await executeReadInternalDoc(state, validId!);
    await executeReadInternalDoc(state, validId!);
    const fourth = await executeReadInternalDoc(state, validId!);

    const parsed = JSON.parse(fourth) as { error: string };
    expect(parsed.error).toBe(MAX_ATTEMPTS_ERROR);
  });

  it("normalizes docId: accepts Getting-Started and getting-started.md", async () => {
    const state: ReadInternalDocState = { callCount: 0 };
    const canonicalId = Object.keys(INTERNAL_DOCS_CONTENT)[0];
    if (!canonicalId) return;
    const result1 = await executeReadInternalDoc(state, canonicalId);
    expect(result1.startsWith("#")).toBe(true);
    const state2: ReadInternalDocState = { callCount: 0 };
    const withSuffix = `${canonicalId}.md`;
    const result2 = await executeReadInternalDoc(state2, withSuffix);
    expect(result2).toBe(result1);
    const state3: ReadInternalDocState = { callCount: 0 };
    const mixedCase = canonicalId
      .split("-")
      .map((s, i) =>
        i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
      )
      .join("-");
    const result3 = await executeReadInternalDoc(state3, mixedCase);
    expect(result3).toBe(result1);
  });

  it("state is per-request: two states do not share call count", async () => {
    const state1: ReadInternalDocState = { callCount: 0 };
    const state2: ReadInternalDocState = { callCount: 0 };
    const validId = Object.keys(INTERNAL_DOCS_CONTENT)[0]!;

    await executeReadInternalDoc(state1, validId);
    await executeReadInternalDoc(state1, validId);
    await executeReadInternalDoc(state1, validId);

    const result2 = await executeReadInternalDoc(state2, validId);
    expect(result2.startsWith("#")).toBe(true);
    expect(result2).not.toContain("Max read attempts");
  });
});

describe("internalDocs module", () => {
  it("exports non-empty INTERNAL_DOCS_INDEX", () => {
    expect(INTERNAL_DOCS_INDEX.length).toBeGreaterThan(0);
    for (const entry of INTERNAL_DOCS_INDEX) {
      expect(entry.id).toBeDefined();
      expect(entry.title).toBeDefined();
      expect(entry.oneLine).toBeDefined();
    }
  });

  it("exports INTERNAL_DOCS_CONTENT with content for each index id", () => {
    for (const entry of INTERNAL_DOCS_INDEX) {
      const content = INTERNAL_DOCS_CONTENT[entry.id];
      expect(content).toBeDefined();
      expect(typeof content).toBe("string");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it("getInternalDocsIndexForPrompt returns one line per doc", () => {
    const promptIndex = getInternalDocsIndexForPrompt();
    expect(promptIndex).toContain("- [");
    expect(promptIndex).toContain("] ");
    const lines = promptIndex.split("\n");
    expect(lines.length).toBe(INTERNAL_DOCS_INDEX.length);
  });
});
