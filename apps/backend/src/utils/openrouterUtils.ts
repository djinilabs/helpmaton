/**
 * Extract OpenRouter generation ID from AI SDK response
 * OpenRouter includes generation ID in response metadata
 */
export function extractOpenRouterGenerationId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK response types are complex
  result: any
): string | undefined {
  try {
    // Check various possible locations for generation ID
    // OpenRouter provider may include it in different places
    if (result?.raw?.id) {
      return result.raw.id;
    }
    if (result?.raw?.generation_id) {
      return result.raw.generation_id;
    }
    if (result?.experimental_providerMetadata?.generationId) {
      return result.experimental_providerMetadata.generationId;
    }
    if (result?.experimental_providerMetadata?.id) {
      return result.experimental_providerMetadata.id;
    }
    // Check response headers if available
    if (result?.response?.headers) {
      const headers = result.response.headers;
      if (headers["x-openrouter-generation-id"]) {
        return headers["x-openrouter-generation-id"];
      }
      if (headers["openrouter-generation-id"]) {
        return headers["openrouter-generation-id"];
      }
    }
    // Check usage metadata
    if (result?.usage?.generationId) {
      return result.usage.generationId;
    }
    // Check if result has a direct id property
    if (result?.id) {
      return result.id;
    }
  } catch (error) {
    console.warn(
      "[extractOpenRouterGenerationId] Error extracting generation ID:",
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }

  return undefined;
}

