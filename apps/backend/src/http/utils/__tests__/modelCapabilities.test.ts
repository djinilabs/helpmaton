import { describe, expect, it } from "vitest";

import type { GenerateTextOptions } from "../agent-model";
import {
  filterGenerateTextOptionsForCapabilities,
  filterModelSettingsForCapabilities,
  resolveToolsForCapabilities,
  supportsReasoning,
  supportsToolCalling,
} from "../modelCapabilities";

describe("modelCapabilities", () => {
  it("treats missing capabilities as unsupported", () => {
    expect(supportsToolCalling(undefined)).toBe(false);
    expect(supportsReasoning(undefined)).toBe(false);

    const settings = filterModelSettingsForCapabilities(
      {
        reasoning: { effort: "high", enabled: true },
        usage: { include: true },
        temperature: 0.5,
        topP: 0.9,
        topK: 20,
        maxTokens: 100,
        stop: ["\n\n"],
      },
      undefined
    );
    expect(settings).toEqual({ usage: { include: true } });

    const stopWhen: GenerateTextOptions["stopWhen"] = () => true;
    const options = filterGenerateTextOptionsForCapabilities(
      {
        temperature: 0.7,
        topP: 0.8,
        topK: 10,
        maxTokens: 42,
        stopSequences: ["END"],
        stopWhen,
      },
      undefined
    );
    expect(options).toEqual({ stopWhen });

    expect(resolveToolsForCapabilities({ foo: "bar" }, undefined)).toBeUndefined();
  });

  it("requires explicit tool_calling support", () => {
    const capabilities = {
      supported_parameters: ["tools", "tool_choice"],
      tool_calling: false,
    };
    expect(supportsToolCalling(capabilities)).toBe(false);
  });

  it("returns tools only when tool_calling is supported", () => {
    const tools = { alpha: { description: "a" } };
    const supported = resolveToolsForCapabilities(tools, {
      tool_calling: true,
    });
    expect(supported).toBe(tools);

    const unsupported = resolveToolsForCapabilities(tools, {
      tool_calling: false,
    });
    expect(unsupported).toBeUndefined();
  });

  it("returns undefined when tools are empty", () => {
    const tools = {};
    const supported = resolveToolsForCapabilities(tools, {
      tool_calling: true,
    });
    expect(supported).toBeUndefined();
  });

  it("detects reasoning support from supported_parameters", () => {
    expect(
      supportsReasoning({
        supported_parameters: ["reasoning"],
      })
    ).toBe(true);
    expect(
      supportsReasoning({
        supported_parameters: ["include_reasoning"],
      })
    ).toBe(true);
    expect(
      supportsReasoning({
        supported_parameters: ["temperature"],
      })
    ).toBe(false);
  });

  it("filters known parameters based on supported_parameters", () => {
    const capabilities = {
      supported_parameters: [
        "temperature",
        "top_p",
        "top_k",
        "max_tokens",
        "stop",
        "reasoning",
      ],
      tool_calling: true,
    };

    const settings = filterModelSettingsForCapabilities(
      {
        reasoning: { effort: "high", enabled: true },
        usage: { include: true },
        temperature: 0.5,
        topP: 0.9,
        topK: 20,
        maxTokens: 100,
        stop: ["\n\n"],
      },
      capabilities
    );
    expect(settings).toEqual({
      reasoning: { effort: "high", enabled: true },
      usage: { include: true },
      temperature: 0.5,
      topP: 0.9,
      topK: 20,
      maxTokens: 100,
      stop: ["\n\n"],
    });

    const stopWhen: GenerateTextOptions["stopWhen"] = () => true;
    const options = filterGenerateTextOptionsForCapabilities(
      {
        temperature: 0.7,
        topP: 0.8,
        topK: 10,
        maxTokens: 42,
        stopSequences: ["END"],
        stopWhen,
      },
      capabilities
    );
    expect(options).toEqual({
      temperature: 0.7,
      topP: 0.8,
      topK: 10,
      maxTokens: 42,
      stopSequences: ["END"],
      stopWhen,
    });
  });
});
