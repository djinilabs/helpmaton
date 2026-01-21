import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenRouterCapabilities } from "../update-pricing.mjs";

test("buildOpenRouterCapabilities derives text-only output", () => {
  const capabilities = buildOpenRouterCapabilities({
    model: {
      architecture: {
        input_modalities: ["Text"],
        output_modalities: ["Text"],
      },
    },
    isReranking: false,
  });

  assert.deepEqual(capabilities.input_modalities, ["text"]);
  assert.deepEqual(capabilities.output_modalities, ["text"]);
  assert.equal(capabilities.text_generation, true);
  assert.equal(capabilities.image_generation, false);
  assert.equal(capabilities.tool_calling, undefined);
});

test("buildOpenRouterCapabilities marks image generation output", () => {
  const capabilities = buildOpenRouterCapabilities({
    model: {
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["IMAGE"],
      },
    },
    isReranking: false,
  });

  assert.equal(capabilities.image_generation, true);
  assert.equal(capabilities.text_generation, false);
  assert.equal(capabilities.image, true);
});

test("buildOpenRouterCapabilities marks rerank models", () => {
  const capabilities = buildOpenRouterCapabilities({
    model: undefined,
    isReranking: true,
  });

  assert.equal(capabilities.rerank, true);
  assert.equal(capabilities.text_generation, false);
});

test("buildOpenRouterCapabilities captures supported parameters", () => {
  const capabilities = buildOpenRouterCapabilities({
    model: {
      architecture: {
        output_modalities: ["text"],
      },
      supported_parameters: ["tools", "response_format"],
    },
    isReranking: false,
  });

  assert.equal(capabilities.tool_calling, true);
  assert.equal(capabilities.structured_output, true);
});
