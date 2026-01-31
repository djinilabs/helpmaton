import { describe, it, expect } from "vitest";

import type { WorkspaceCreditTransactionRecord } from "../../tables/schema";
import {
  classifyToolChargeType,
  classifyTransactionChargeType,
} from "../aggregation";

const baseTransaction: WorkspaceCreditTransactionRecord = {
  pk: "workspaces/workspace-1",
  sk: "transactions/txn-1",
  createdAt: new Date().toISOString(),
  source: "text-generation",
  amountNanoUsd: -100,
} as WorkspaceCreditTransactionRecord;

describe("classifyTransactionChargeType", () => {
  it("classifies embedding-generation transactions", () => {
    const result = classifyTransactionChargeType({
      ...baseTransaction,
      source: "embedding-generation",
      model: "thenlper/gte-base",
    } as WorkspaceCreditTransactionRecord);
    expect(result).toBe("embeddings");
  });

  it("classifies scrape transactions by model name", () => {
    const result = classifyTransactionChargeType({
      ...baseTransaction,
      source: "text-generation",
      model: "scrape",
    } as WorkspaceCreditTransactionRecord);
    expect(result).toBe("scrape");
  });

  it("classifies image generation transactions by model capabilities", () => {
    const result = classifyTransactionChargeType({
      ...baseTransaction,
      source: "text-generation",
      model: "google/gemini-3-pro-image-preview",
    } as WorkspaceCreditTransactionRecord);
    expect(result).toBe("imageGeneration");
  });

  it("defaults text-generation transactions to text generation", () => {
    const result = classifyTransactionChargeType({
      ...baseTransaction,
      source: "text-generation",
      model: "google/gemini-2.5-flash",
    } as WorkspaceCreditTransactionRecord);
    expect(result).toBe("textGeneration");
  });
});

describe("classifyToolChargeType", () => {
  it("classifies embedding tool calls", () => {
    expect(
      classifyToolChargeType("document-search-embedding", "openrouter")
    ).toBe("embeddings");
  });

  it("classifies reranking tool calls", () => {
    expect(classifyToolChargeType("rerank", "openrouter")).toBe("reranking");
  });

  it("classifies Tavily tool calls by supplier", () => {
    expect(classifyToolChargeType("search_web", "tavily")).toBe("tavily");
  });

  it("classifies Exa tool calls by supplier", () => {
    expect(classifyToolChargeType("search", "exa")).toBe("exa");
  });
});
