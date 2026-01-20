import { Sentry, ensureError } from "./sentry";

type StepCandidate = {
  response?: {
    id?: unknown;
  };
};

const isGenerationId = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith("gen-");

const logResultStructure = (result: unknown) => {
  console.log(
    "[extractOpenRouterGenerationId] Full result structure:",
    JSON.stringify(result, null, 2)
  );

  console.log("[extractOpenRouterGenerationId] Result structure summary:", {
    hasRaw: !!(result as { raw?: unknown })?.raw,
    hasExperimentalProviderMetadata: !!(result as {
      experimental_providerMetadata?: unknown;
    })?.experimental_providerMetadata,
    hasResponse: !!(result as { response?: unknown })?.response,
    hasUsage: !!(result as { usage?: unknown })?.usage,
    hasId: !!(result as { id?: unknown })?.id,
    rawKeys:
      (result as { raw?: Record<string, unknown> })?.raw
        ? Object.keys(
            (result as { raw: Record<string, unknown> }).raw
          )
        : [],
    experimentalProviderMetadataKeys: (result as {
      experimental_providerMetadata?: Record<string, unknown>;
    })?.experimental_providerMetadata
      ? Object.keys(
          (result as {
            experimental_providerMetadata: Record<string, unknown>;
          }).experimental_providerMetadata
        )
      : [],
    responseHeaders:
      (result as { response?: { headers?: Record<string, unknown> } })?.response
        ?.headers
        ? Object.keys(
            (result as {
              response: { headers: Record<string, unknown> };
            }).response.headers
          )
        : [],
    usageKeys: (result as { usage?: Record<string, unknown> })?.usage
      ? Object.keys(
          (result as { usage: Record<string, unknown> }).usage
        )
      : [],
  });
};

const findGenerationIdInSteps = (
  steps: StepCandidate[],
  logLabel: string
): string | undefined => {
  for (const step of steps) {
    if (isGenerationId(step?.response?.id)) {
      console.log(
        `[extractOpenRouterGenerationId] Found in ${logLabel}:`,
        step.response?.id
      );
      return step.response?.id;
    }
  }
  return undefined;
};

const getResolvedSteps = (result: unknown): StepCandidate[] | null => {
  const status = (result as { _steps?: { status?: { type?: string; value?: unknown } } })
    ?._steps?.status;
  if (status?.type !== "resolved" || !status.value) {
    return null;
  }
  return Array.isArray(status.value)
    ? (status.value as StepCandidate[])
    : [status.value as StepCandidate];
};

const findGenerationIdInHeaders = (
  headers: Record<string, unknown>
): string | undefined => {
  if (headers["x-openrouter-generation-id"]) {
    console.log(
      "[extractOpenRouterGenerationId] Found in response.headers['x-openrouter-generation-id']"
    );
    return headers["x-openrouter-generation-id"] as string;
  }
  if (headers["openrouter-generation-id"]) {
    console.log(
      "[extractOpenRouterGenerationId] Found in response.headers['openrouter-generation-id']"
    );
    return headers["openrouter-generation-id"] as string;
  }
  return undefined;
};

/**
 * Extract OpenRouter generation ID from AI SDK response
 * OpenRouter includes generation ID in response metadata
 */
export function extractOpenRouterGenerationId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK response types are complex
  result: any
): string | undefined {
  try {
    logResultStructure(result);

    // Check result.steps[] (generateText structure) first
    if (Array.isArray(result?.steps)) {
      const fromSteps = findGenerationIdInSteps(
        result.steps,
        "steps[].response.id"
      );
      if (fromSteps) {
        return fromSteps;
      }
    }

    // Check _steps.status.value[] (streamText structure) if not found
    const resolvedSteps = getResolvedSteps(result);
    if (resolvedSteps) {
      const fromResolvedSteps = findGenerationIdInSteps(
        resolvedSteps,
        "_steps.status.value[].response.id"
      );
      if (fromResolvedSteps) {
        return fromResolvedSteps;
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
      const headersId = findGenerationIdInHeaders(result.response.headers);
      if (headersId) {
        return headersId;
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
    Sentry.captureException(ensureError(error), {
      tags: {
        context: "openrouter",
        operation: "extract-generation-id",
      },
    });
  }

  return undefined;
}

/**
 * Extract all OpenRouter generation IDs from AI SDK response
 * Returns array of all generation IDs found in _steps.status.value[]
 * @param result - AI SDK response object
 * @returns Array of generation IDs, or empty array if none found
 */
export function extractAllOpenRouterGenerationIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK response types are complex
  result: any
): string[] {
  const generationIds: string[] = [];

  try {
    // Check result.steps[] (generateText structure) first
    if (Array.isArray(result?.steps)) {
      for (const step of result.steps) {
        if (
          step?.response?.id &&
          typeof step.response.id === "string" &&
          step.response.id.startsWith("gen-")
        ) {
          generationIds.push(step.response.id);
        }
      }
    }

    // Check _steps.status.value[] (streamText structure) if no IDs found
    if (
      generationIds.length === 0 &&
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
          generationIds.push(step.response.id);
        }
      }
    }

    // Fallback to single ID extraction for backward compatibility
    // Only if no IDs found in steps/_steps
    if (generationIds.length === 0) {
      const singleId = extractOpenRouterGenerationId(result);
      if (singleId) {
        generationIds.push(singleId);
      }
    }

    console.log(
      "[extractAllOpenRouterGenerationIds] Extracted generation IDs:",
      {
        count: generationIds.length,
        generationIds,
      }
    );

    return generationIds;
  } catch (error) {
    console.warn(
      "[extractAllOpenRouterGenerationIds] Error extracting generation IDs:",
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }
    );
    return [];
  }
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
    let totalCost = 0;
    let foundAnyCost = false;

    // Check result.steps[] (generateText structure) first
    if (Array.isArray(result?.steps)) {
      for (const step of result.steps) {
        const cost = step?.providerMetadata?.openrouter?.usage?.cost;
        if (typeof cost === "number" && cost >= 0) {
          totalCost += cost;
          foundAnyCost = true;
        }
      }
    }

    // Check _steps.status.value[] (streamText structure) if no costs found
    if (
      !foundAnyCost &&
      result?._steps?.status?.type === "resolved" &&
      result._steps.status.value
    ) {
      const steps = Array.isArray(result._steps.status.value)
        ? result._steps.status.value
        : [result._steps.status.value];

      for (const step of steps) {
        const cost = step?.providerMetadata?.openrouter?.usage?.cost;
        if (typeof cost === "number" && cost >= 0) {
          totalCost += cost;
          foundAnyCost = true;
        }
      }
    }

    if (foundAnyCost) {
      console.log(
        "[extractOpenRouterCost] Found cost in steps/providerMetadata:",
        totalCost
      );
      return totalCost;
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
