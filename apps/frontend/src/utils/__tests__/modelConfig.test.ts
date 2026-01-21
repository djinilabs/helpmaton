import { describe, expect, it } from "vitest";

import type { ModelCapabilities } from "../api";
import {
  filterModelsByCapability,
  getCapabilityLabels,
  resolveDefaultModel,
} from "../modelConfig";

describe("modelConfig capability helpers", () => {
  it("filters models by required capability", () => {
    const models = ["alpha", "beta", "gamma"];
    const capabilities: Record<string, ModelCapabilities> = {
      alpha: { text_generation: true },
      beta: { text_generation: false },
      gamma: {},
    };

    expect(
      filterModelsByCapability(models, capabilities, "text_generation")
    ).toEqual(["alpha"]);
  });

  it("returns empty list when capabilities are missing", () => {
    const models = ["alpha", "beta"];
    expect(filterModelsByCapability(models, undefined, "rerank")).toEqual([]);
  });

  it("resolves default model within filtered list", () => {
    expect(resolveDefaultModel(["alpha", "beta"], "beta")).toBe("beta");
  });

  it("falls back to first model when default is missing", () => {
    expect(resolveDefaultModel(["alpha", "beta"], "missing")).toBe("alpha");
  });

  it("returns empty default when no models exist", () => {
    expect(resolveDefaultModel([], "beta")).toBe("");
  });

  it("builds capability labels in a stable order", () => {
    const labels = getCapabilityLabels({
      tool_calling: true,
      text_generation: true,
      image_generation: false,
    });
    expect(labels).toEqual(["text_generation", "tool_calling"]);
  });
});
