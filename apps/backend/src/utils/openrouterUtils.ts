/**
 * Extract OpenRouter generation ID from AI SDK response
 * OpenRouter includes generation ID in response metadata
 */
export function extractOpenRouterGenerationId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK response types are complex
  result: any
): string | undefined {
  try {
    // Log the full result structure for debugging
    console.log(
      "[extractOpenRouterGenerationId] Full result structure:",
      JSON.stringify(result, null, 2)
    );

    // Log summary of result structure for quick reference
    console.log("[extractOpenRouterGenerationId] Result structure summary:", {
      hasRaw: !!result?.raw,
      hasExperimentalProviderMetadata: !!result?.experimental_providerMetadata,
      hasResponse: !!result?.response,
      hasUsage: !!result?.usage,
      hasId: !!result?.id,
      rawKeys: result?.raw ? Object.keys(result.raw) : [],
      experimentalProviderMetadataKeys: result?.experimental_providerMetadata
        ? Object.keys(result.experimental_providerMetadata)
        : [],
      responseHeaders: result?.response?.headers
        ? Object.keys(result.response.headers)
        : [],
      usageKeys: result?.usage ? Object.keys(result.usage) : [],
    });

    // Check _steps.status.value[0].response.id (OpenRouter AI SDK structure)
    if (
      result?._steps?.status?.type === "resolved" &&
      result._steps.status.value
    ) {
      const steps = Array.isArray(result._steps.status.value)
        ? result._steps.status.value
        : [result._steps.status.value];

      for (const step of steps) {
        if (
          step?.response?.id &&
          typeof step.response.id === "string" &&
          step.response.id.startsWith("gen-")
        ) {
          console.log(
            "[extractOpenRouterGenerationId] Found in _steps.status.value[].response.id:",
            step.response.id
          );
          return step.response.id;
        }
      }
    }

    // Check various possible locations for generation ID
    // OpenRouter provider may include it in different places
    if (result?.raw?.id) {
      console.log("[extractOpenRouterGenerationId] Found in result.raw.id");
      return result.raw.id;
    }
    if (result?.raw?.generation_id) {
      console.log(
        "[extractOpenRouterGenerationId] Found in result.raw.generation_id"
      );
      return result.raw.generation_id;
    }
    if (result?.experimental_providerMetadata?.generationId) {
      console.log(
        "[extractOpenRouterGenerationId] Found in experimental_providerMetadata.generationId"
      );
      return result.experimental_providerMetadata.generationId;
    }
    if (result?.experimental_providerMetadata?.id) {
      console.log(
        "[extractOpenRouterGenerationId] Found in experimental_providerMetadata.id"
      );
      return result.experimental_providerMetadata.id;
    }
    // Check response headers if available
    if (result?.response?.headers) {
      const headers = result.response.headers;
      if (headers["x-openrouter-generation-id"]) {
        console.log(
          "[extractOpenRouterGenerationId] Found in response.headers['x-openrouter-generation-id']"
        );
        return headers["x-openrouter-generation-id"];
      }
      if (headers["openrouter-generation-id"]) {
        console.log(
          "[extractOpenRouterGenerationId] Found in response.headers['openrouter-generation-id']"
        );
        return headers["openrouter-generation-id"];
      }
    }
    // Check usage metadata
    if (result?.usage?.generationId) {
      console.log(
        "[extractOpenRouterGenerationId] Found in result.usage.generationId"
      );
      return result.usage.generationId;
    }
    // Check if result has a direct id property
    if (result?.id) {
      console.log("[extractOpenRouterGenerationId] Found in result.id");
      return result.id;
    }

    console.warn(
      "[extractOpenRouterGenerationId] Generation ID not found in any expected location. Full result structure:",
      JSON.stringify(result, null, 2)
    );
  } catch (error) {
    console.warn(
      "[extractOpenRouterGenerationId] Error extracting generation ID:",
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
  }

  return undefined;
}

/**
 * Extract OpenRouter cost from AI SDK response
 * OpenRouter includes cost in providerMetadata.openrouter.usage.cost
 * @param result - AI SDK response object
 * @returns Cost in USD, or undefined if not found
 */
export function extractOpenRouterCost(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK response types are complex
  result: any
): number | undefined {
  try {
    // Check _steps.status.value[0].providerMetadata.openrouter.usage.cost (OpenRouter AI SDK structure)
    if (
      result?._steps?.status?.type === "resolved" &&
      result._steps.status.value
    ) {
      const steps = Array.isArray(result._steps.status.value)
        ? result._steps.status.value
        : [result._steps.status.value];

      for (const step of steps) {
        const cost = step?.providerMetadata?.openrouter?.usage?.cost;
        if (typeof cost === "number" && cost >= 0) {
          console.log(
            "[extractOpenRouterCost] Found in _steps.status.value[].providerMetadata.openrouter.usage.cost:",
            cost
          );
          return cost;
        }
      }
    }

    // Check other possible locations
    if (typeof result?.providerMetadata?.openrouter?.usage?.cost === "number") {
      const cost = result.providerMetadata.openrouter.usage.cost;
      if (cost >= 0) {
        console.log(
          "[extractOpenRouterCost] Found in providerMetadata.openrouter.usage.cost:",
          cost
        );
        return cost;
      }
    }

    console.log("[extractOpenRouterCost] Cost not found in expected locations");
  } catch (error) {
    console.warn("[extractOpenRouterCost] Error extracting cost:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  return undefined;
}
