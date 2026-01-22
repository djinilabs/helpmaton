import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from apps/backend/.env if it exists
const backendEnvPath = join(__dirname, "..", "apps", "backend", ".env");
if (existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath });
  console.log(`[Update Pricing] Loaded environment variables from ${backendEnvPath}`);
} else {
  console.log(`[Update Pricing] No .env file found at ${backendEnvPath}, using system environment variables`);
}

/**
 * List of excluded model names and patterns
 * Models matching these patterns will be excluded from pricing updates
 */
const EXCLUDED_MODELS = [
  "gemini-1.5-flash",
  "gemini-1.5-pro"
];

/**
 * List of excluded model name patterns
 * Models containing these patterns will be excluded from pricing updates
 */
const EXCLUDED_PATTERNS = [
  "-tts",           // TTS models (e.g., gemini-2.5-flash-preview-tts)
  "tts-",           // TTS models with prefix
];

/**
 * Check if a model name should be excluded from pricing updates
 * @param {string} modelName - The model name to check
 * @returns {boolean} True if the model should be excluded
 */
function isExcludedModel(modelName) {
  // Check for exact match with excluded models
  if (EXCLUDED_MODELS.includes(modelName)) {
    return true;
  }
  
  // Check for pattern matches
  for (const pattern of EXCLUDED_PATTERNS) {
    if (modelName.includes(pattern)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a model is a re-ranking model
 * Re-ranking models are identified by containing "rerank" in their name (case-insensitive)
 * @param {string} modelName - The model name to check
 * @returns {boolean} True if the model is a re-ranking model
 */
function isRerankingModel(modelName) {
  if (!modelName || typeof modelName !== 'string') {
    return false;
  }
  const lowerModel = modelName.toLowerCase();
  return lowerModel.includes("rerank");
}

/**
 * Normalize arrays of strings for capability fields
 * @param {*} value - Potential array of strings
 * @returns {string[]} Normalized list of lowercase strings
 */
function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(normalized));
}

/**
 * Merge derived capabilities with existing capabilities from pricing.json
 * Existing capabilities override derived values when explicitly set.
 * @param {Object | undefined} derived - Capabilities derived from API
 * @param {Object | undefined} existing - Existing capabilities from pricing.json
 * @returns {Object | undefined} Merged capabilities
 */
function mergeCapabilities(derived, existing) {
  if (!derived && !existing) {
    return undefined;
  }

  const merged = {
    ...(derived || {}),
    ...(existing || {}),
  };

  const applyExistingValue = (key) => {
    if (!existing) return;
    if (Object.prototype.hasOwnProperty.call(existing, key)) {
      merged[key] = existing[key];
    }
  };

  applyExistingValue("input_modalities");
  applyExistingValue("output_modalities");
  applyExistingValue("supported_parameters");

  if (existing && Object.prototype.hasOwnProperty.call(existing, "image")) {
    merged.image = existing.image;
    if (!Object.prototype.hasOwnProperty.call(existing, "image_generation")) {
      merged.image_generation = existing.image;
    }
  }

  if (merged.image_generation === undefined && merged.image !== undefined) {
    merged.image_generation = merged.image;
  }

  if (merged.image === undefined && merged.image_generation !== undefined) {
    merged.image = merged.image_generation;
  }

  return merged;
}

/**
 * Build OpenRouter capabilities object for pricing.json
 * @param {Object} options
 * @param {Object | undefined} options.model - OpenRouter model data
 * @param {boolean} options.isReranking - Whether the model is a re-ranking model
 * @param {Object | undefined} options.existingCapabilities - Existing capabilities from pricing.json
 * @returns {Object | undefined} Capabilities object
 */
export function buildOpenRouterCapabilities({
  model,
  isReranking,
  existingCapabilities,
} = {}) {
  const architecture = model?.architecture || {};

  const inputModalities = normalizeStringArray(
    architecture.input_modalities ?? model?.input_modalities
  );
  const outputModalities = normalizeStringArray(
    architecture.output_modalities ?? model?.output_modalities
  );
  const supportedParameters = normalizeStringArray(
    model?.supported_parameters ??
      architecture.supported_parameters ??
      model?.supportedParameters
  );

  const hasOutputModalities = outputModalities.length > 0;
  const hasSupportedParameters = supportedParameters.length > 0;

  const derived = {};

  if (inputModalities.length > 0) {
    derived.input_modalities = inputModalities;
  }

  if (outputModalities.length > 0) {
    derived.output_modalities = outputModalities;
  }

  if (supportedParameters.length > 0) {
    derived.supported_parameters = supportedParameters;
  }

  if (isReranking !== undefined) {
    derived.rerank = Boolean(isReranking);
  }

  if (isReranking) {
    derived.text_generation = false;
  } else if (hasOutputModalities) {
    derived.text_generation = outputModalities.includes("text");
  }

  if (hasOutputModalities) {
    derived.image_generation = outputModalities.includes("image");
  }

  if (hasSupportedParameters) {
    derived.tool_calling =
      supportedParameters.includes("tools") ||
      supportedParameters.includes("tool_choice");
    derived.structured_output = supportedParameters.includes("response_format");
  }

  if (derived.image_generation !== undefined && derived.image === undefined) {
    derived.image = derived.image_generation;
  }

  const merged = mergeCapabilities(derived, existingCapabilities);
  if (!merged || Object.keys(merged).length === 0) {
    return undefined;
  }

  return merged;
}

/**
 * Validate that all required API keys are defined
 * Throws an error and exits if any are missing
 */
function validateRequiredApiKeys() {
  const requiredKeys = [
    { name: "GEMINI_API_KEY", env: process.env.GEMINI_API_KEY },
    { name: "OPENROUTER_API_KEY", env: process.env.OPENROUTER_API_KEY },
  ];

  const missingKeys = requiredKeys.filter(({ env }) => !env);

  if (missingKeys.length > 0) {
    const missingKeyNames = missingKeys.map(({ name }) => name).join(", ");
    console.error(`[Update Pricing] ERROR: Required API keys are not defined: ${missingKeyNames}`);
    console.error(`[Update Pricing] Please set these environment variables in ${backendEnvPath} or as system environment variables`);
    process.exit(1);
  }

  console.log("[Update Pricing] All required API keys are defined");
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


/**
 * Get the default pricing structure
 * @returns {Object} Default pricing configuration
 */
function getDefaultPricing() {
  return {
    providers: {
      google: {
        models: {},
      },
      openrouter: {
        models: {},
      },
    },
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Load pricing file or return default structure if it doesn't exist
 * @param {string} pricingPath - Path to the pricing file
 * @returns {Object} Pricing configuration object
 */
function loadPricingFileOrCreateDefault(pricingPath) {
  if (existsSync(pricingPath)) {
    try {
      const content = readFileSync(pricingPath, "utf-8");
      return JSON.parse(content);
    } catch (error) {
      console.warn(`[Update Pricing] Failed to parse existing pricing file: ${error.message}. Using default structure.`);
      return getDefaultPricing();
    }
  } else {
    console.log(`[Update Pricing] Pricing file does not exist at ${pricingPath}. Will create new file with fetched pricing.`);
    return getDefaultPricing();
  }
}

/**
 * Round to 3 decimal places (matching pricing.json precision)
 */
function roundPrice(price) {
  return Math.round(price * 1000) / 1000;
}

/**
 * Check if a price value is invalid (negative, undefined, null, NaN, or non-number)
 * @param {*} value - Price value to check
 * @returns {boolean} True if price is invalid
 */
function isInvalidPrice(value) {
  // Check for undefined or null
  if (value === undefined || value === null) {
    return true;
  }
  
  // Check if it's a number
  if (typeof value !== 'number') {
    return true;
  }
  
  // Check for NaN
  if (isNaN(value)) {
    return true;
  }
  
  // Check for negative
  if (value < 0) {
    return true;
  }
  
  return false;
}

/**
 * Check if pricing structure contains any invalid or negative prices
 * Supports both flat pricing and tiered pricing
 * For re-ranking models, allows request-only pricing (input/output can be 0 or missing)
 * @param {Object} pricing - Pricing structure (flat or tiered)
 * @param {boolean} isReranking - Whether this is a re-ranking model
 * @returns {boolean} True if any price is invalid or negative
 */
function hasInvalidOrNegativePricing(pricing, isReranking = false) {
  if (!pricing || typeof pricing !== 'object') {
    return false;
  }

  // For re-ranking models, allow request-only pricing
  if (isReranking) {
    // Re-ranking models must have at least request pricing
    if (pricing.request !== undefined) {
      if (isInvalidPrice(pricing.request)) {
        return true;
      }
      // For reranking models, request price must be positive (greater than 0)
      // A price of 0 would mean free reranking, which is likely unintentional
      if (pricing.request <= 0) {
        return true;
      }
      // If request pricing is valid, allow input/output to be 0 or missing
      // Check optional fields if they exist
      if (pricing.input !== undefined && isInvalidPrice(pricing.input)) {
        return true;
      }
      if (pricing.output !== undefined && isInvalidPrice(pricing.output)) {
        return true;
      }
      if (pricing.cachedInput !== undefined && isInvalidPrice(pricing.cachedInput)) {
        return true;
      }
      if (pricing.reasoning !== undefined && isInvalidPrice(pricing.reasoning)) {
        return true;
      }
      return false;
    }
    // If no request pricing, check if input/output are provided and valid
    if (pricing.input !== undefined || pricing.output !== undefined) {
      if (isInvalidPrice(pricing.input) || isInvalidPrice(pricing.output)) {
        return true;
      }
      // Check optional fields if they exist
      if (pricing.cachedInput !== undefined && isInvalidPrice(pricing.cachedInput)) {
        return true;
      }
      if (pricing.reasoning !== undefined && isInvalidPrice(pricing.reasoning)) {
        return true;
      }
      return false;
    }
    // Re-ranking model with no pricing at all is invalid
    return true;
  }

  // Handle flat pricing for non-reranking models
  if (pricing.input !== undefined || pricing.output !== undefined) {
    // Check if input or output are invalid (required fields)
    if (isInvalidPrice(pricing.input) || isInvalidPrice(pricing.output)) {
      return true;
    }
    // Check optional fields if they exist
    if (pricing.cachedInput !== undefined && isInvalidPrice(pricing.cachedInput)) {
      return true;
    }
    if (pricing.reasoning !== undefined && isInvalidPrice(pricing.reasoning)) {
      return true;
    }
    // Request pricing is optional, but if present must be valid
    if (pricing.request !== undefined && isInvalidPrice(pricing.request)) {
      return true;
    }
    return false;
  }

  // Handle tiered pricing
  if (pricing.tiers && Array.isArray(pricing.tiers)) {
    for (const tier of pricing.tiers) {
      if (!tier || typeof tier !== 'object') continue;
      
      // In tiered pricing, input and output are required
      if (isInvalidPrice(tier.input) || isInvalidPrice(tier.output)) {
        return true;
      }
      // Check optional fields if they exist
      if (tier.cachedInput !== undefined && isInvalidPrice(tier.cachedInput)) {
        return true;
      }
      if (tier.reasoning !== undefined && isInvalidPrice(tier.reasoning)) {
        return true;
      }
      // Request pricing is optional, but if present must be valid
      if (tier.request !== undefined && isInvalidPrice(tier.request)) {
        return true;
      }
    }
    return false;
  }

  return false;
}


/**
 * Get Google models list from API
 * Throws error if API key is missing or API call fails
 */
async function getGoogleModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set, cannot fetch Google models");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const response = await fetch(url, {
    headers: {
      "Referer": process.env.GOOGLE_API_REFERER || "http://localhost:3000/api/webhook",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    // Get response body for more details
    let responseBody = "";
    let responseData = null;
    try {
      responseBody = await response.text();
      try {
        responseData = JSON.parse(responseBody);
      } catch {
        // Not JSON, keep as text
      }
    } catch (e) {
      // Couldn't read body
    }

    const errorDetails = {
      status: response.status,
      statusText: response.statusText,
      url: url.replace(apiKey, "***REDACTED***"),
      headers: Object.fromEntries(response.headers.entries()),
      body: responseData || responseBody,
    };

    console.error("[Update Pricing] Google API error details:", JSON.stringify(errorDetails, null, 2));
    
    throw new Error(
      `Failed to fetch Google models: HTTP ${response.status}: ${response.statusText}. ` +
      `Response: ${responseData ? JSON.stringify(responseData) : responseBody.substring(0, 500)}`
    );
  }

  const data = await response.json();
  
  // Filter for models that generate content (exclude embeddings)
  const chatModels = (data.models || []).filter((m) => 
    m.supportedGenerationMethods && 
    m.supportedGenerationMethods.includes("generateContent")
  );

  if (chatModels.length === 0) {
    throw new Error("No chat models found in Google API response");
  }

  // Map to model names and filter out excluded models
  const modelNames = chatModels.map(model => model.name.replace("models/", ""));
  const filteredModels = modelNames.filter(modelName => !isExcludedModel(modelName));
  
  if (filteredModels.length === 0) {
    throw new Error("No valid models found after filtering excluded models");
  }
  
  const excludedCount = modelNames.length - filteredModels.length;
  if (excludedCount > 0) {
    console.log(`[Update Pricing] Excluded ${excludedCount} model(s) from pricing update`);
  }

  return filteredModels;
}

/**
 * Get OpenRouter models list from API
 * Throws error if API key is missing or API call fails
 */
async function getOpenRouterModels() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not set, cannot fetch OpenRouter models");
  }

  const url = "https://openrouter.ai/api/v1/models";
  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    // Get response body for more details
    let responseBody = "";
    let responseData = null;
    try {
      responseBody = await response.text();
      try {
        responseData = JSON.parse(responseBody);
      } catch {
        // Not JSON, keep as text
      }
    } catch (e) {
      // Couldn't read body
    }

    const errorDetails = {
      status: response.status,
      statusText: response.statusText,
      url: url,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseData || responseBody,
    };

    console.error("[Update Pricing] OpenRouter API error details:", JSON.stringify(errorDetails, null, 2));
    
    throw new Error(
      `Failed to fetch OpenRouter models: HTTP ${response.status}: ${response.statusText}. ` +
      `Response: ${responseData ? JSON.stringify(responseData) : responseBody.substring(0, 500)}`
    );
  }

  const data = await response.json();
  
  // OpenRouter API returns an array of models
  const models = data.data || [];
  
  if (models.length === 0) {
    throw new Error("No models found in OpenRouter API response");
  }

  // Extract model IDs (they use format like "google/gemini-2.5-flash")
  const modelNames = models.map(model => model.id).filter(Boolean);
  
  if (modelNames.length === 0) {
    throw new Error("No valid model IDs found in OpenRouter API response");
  }

  // Check for re-ranking models in the raw API response
  const rerankingModelsInApi = modelNames.filter(modelName => isRerankingModel(modelName));
  if (rerankingModelsInApi.length > 0) {
    console.log(`[Update Pricing] Found ${rerankingModelsInApi.length} re-ranking model(s) in OpenRouter API: ${rerankingModelsInApi.join(", ")}`);
  } else {
    console.log(`[Update Pricing] No re-ranking models found in OpenRouter API response (checked ${modelNames.length} models)`);
  }

  // Filter out excluded models
  const filteredModels = modelNames.filter(modelName => !isExcludedModel(modelName));
  
  if (filteredModels.length === 0) {
    throw new Error("No valid models found after filtering excluded models");
  }
  
  const excludedCount = modelNames.length - filteredModels.length;
  if (excludedCount > 0) {
    console.log(`[Update Pricing] Excluded ${excludedCount} OpenRouter model(s) from pricing update`);
  }

  return { models: filteredModels, rawModels: models };
}

/**
 * Known re-ranking models and their pricing
 * Re-ranking models are not included in OpenRouter's /api/v1/models endpoint
 * but are available via /api/v1/rerank endpoint
 * Pricing is per-request (not per-token)
 * 
 * To add a new re-ranking model:
 * 1. Verify it's available on OpenRouter's rerank endpoint
 * 2. Add it here with request pricing (per-request cost in USD)
 * 3. Set input/output to 0 since re-ranking uses per-request pricing
 */
const knownRerankingModels = {
  "cohere/rerank-v3": {
    input: 0,
    output: 0,
    request: 0.001, // $0.001 per request
  },
  "cohere/rerank-english-v3.0": {
    input: 0,
    output: 0,
    request: 0.001,
  },
  "cohere/rerank-multilingual-v3.0": {
    input: 0,
    output: 0,
    request: 0.001,
  },
  "jinaai/jina-reranker-v1-base-en": {
    input: 0,
    output: 0,
    request: 0.0001,
  },
  "jinaai/jina-reranker-v1-turbo-en": {
    input: 0,
    output: 0,
    request: 0.0002,
  },
};

/**
 * Known Google pricing (per 1M tokens)
 * Format supports both flat pricing (backward compatible) and tiered pricing
 * Pricing verified against: https://ai.google.dev/pricing
 * 
 * Cached token pricing: Google charges ~10% of input token rate for cached tokens.
 * This is automatically calculated from input pricing if not explicitly specified.
 * 
 * To add tiered pricing, use the 'tiers' array format:
 * {
 *   tiers: [
 *     { threshold: 200000, input: 1.25, output: 5.0, cachedInput: 0.125 },
 *     { input: 2.5, output: 10.0, cachedInput: 0.25 } // No threshold = above previous threshold
 *   ]
 * }
 * 
 * To add reasoning token pricing, include 'reasoning' field:
 * - In flat pricing: { input: 1.0, output: 2.0, reasoning: 3.5, cachedInput: 0.1 }
 * - In tiered pricing: { threshold: 200000, input: 1.25, output: 5.0, reasoning: 10.0, cachedInput: 0.125 }
 * 
 * Note: Google's API doesn't expose pricing information, so cached token pricing
 * is calculated as 10% of input token pricing based on Google's documentation.
 */
const knownPricing = {
  "gemini-2.5-flash": {
    // Flat pricing
    input: 0.075,
    output: 0.3,
    cachedInput: 0.0075, // ~10% of input (0.075 * 0.1)
  },
  "gemini-2.0-flash-exp": {
    input: 0.075,
    output: 0.3,
    cachedInput: 0.0075, // ~10% of input
  },
  "gemini-1.5-flash": {
    input: 0.075,
    output: 0.3,
    cachedInput: 0.0075, // ~10% of input
  },
  "gemini-1.5-pro": {
    // Tiered pricing: different rates for tokens below/above 200k threshold
    tiers: [
      {
        threshold: 200000,
        input: 1.25,
        output: 5.0,
        cachedInput: 0.125, // ~10% of input (1.25 * 0.1)
      },
      {
        // No threshold means "above 200k tokens"
        input: 2.50,
        output: 10.0,
        cachedInput: 0.25, // ~10% of input (2.50 * 0.1)
      },
    ],
  },
  "gemini-2.5-pro": {
    // Tiered pricing: different rates for tokens below/above 200k threshold
    tiers: [
      {
        threshold: 200000,
        input: 1.25,
        output: 10.0,
        cachedInput: 0.125, // ~10% of input (1.25 * 0.1)
      },
      {
        // No threshold means "above 200k tokens"
        input: 2.50,
        output: 15.0,
        cachedInput: 0.25, // ~10% of input (2.50 * 0.1)
      },
    ],
  },
};

/**
 * Calculate cached input pricing from input pricing
 * Cached tokens are typically charged at ~10% of input token rate
 * @param {number} inputPrice - Input token price per 1M tokens
 * @returns {number} Cached input token price per 1M tokens
 */
function calculateCachedInputPrice(inputPrice) {
  return roundPrice(inputPrice * 0.1);
}

/**
 * Ensure cached input pricing is present in pricing structure
 * If missing, calculate it as 10% of input pricing
 * @param {Object} pricing - Pricing structure (flat or tiered)
 * @returns {Object} Pricing structure with cachedInput added if missing
 */
function ensureCachedInputPricing(pricing) {
  // Handle flat pricing
  if (pricing.input !== undefined) {
    if (pricing.cachedInput === undefined) {
      pricing.cachedInput = calculateCachedInputPrice(pricing.input);
      console.log(`[Update Pricing] Calculated cachedInput pricing: ${pricing.cachedInput} (10% of input ${pricing.input})`);
    }
    return pricing;
  }

  // Handle tiered pricing
  if (pricing.tiers && Array.isArray(pricing.tiers)) {
    for (const tier of pricing.tiers) {
      if (tier.input !== undefined && tier.cachedInput === undefined) {
        tier.cachedInput = calculateCachedInputPrice(tier.input);
        console.log(`[Update Pricing] Calculated cachedInput pricing for tier: ${tier.cachedInput} (10% of input ${tier.input})`);
      }
    }
    return pricing;
  }

  return pricing;
}

/**
 * Get pricing for Google models
 * Note: Google API doesn't provide pricing via API, so we use known pricing structure.
 * Cached token pricing is automatically calculated as 10% of input pricing if not specified.
 * 
 * Returns pricing in the new format supporting both flat and tiered pricing
 */
function getGooglePricingForModels(models) {
  const pricing = {};
  
  // Match models to known pricing
  for (const modelId of models) {
    // Skip excluded models
    if (isExcludedModel(modelId)) {
      console.log(`[Update Pricing] Skipping excluded model ${modelId} in pricing lookup`);
      continue;
    }
    
    let modelPricing = null;
    
    // Try exact match first
    if (knownPricing[modelId]) {
      modelPricing = knownPricing[modelId];
    } else {
      // Try partial matches for variants (more specific matching)
      for (const [knownModel, price] of Object.entries(knownPricing)) {
        if (modelId === knownModel || modelId.startsWith(knownModel + "-")) {
          modelPricing = price;
          break;
        }
      }
    }

    if (modelPricing) {
      // Deep copy to avoid mutating the original
      const pricingCopy = JSON.parse(JSON.stringify(modelPricing));
      // Ensure cached input pricing is present
      ensureCachedInputPricing(pricingCopy);
      
      // Skip models with invalid or negative pricing
      if (hasInvalidOrNegativePricing(pricingCopy)) {
        console.log(`[Update Pricing] Skipping Google model ${modelId} due to invalid or negative pricing`);
        continue;
      }
      
      pricing[modelId] = pricingCopy;
    }
  }

  return pricing;
}

/**
 * Transform OpenRouter API response to pricing.json format
 * OpenRouter API returns pricing in different formats, we need to normalize it
 * @param {Array} rawModels - Raw model objects from OpenRouter API
 * @param {Array} modelNames - Filtered model names to process
 * @param {Object} currentPricing - Current pricing config (for capability merges)
 * @returns {Object} Pricing object with model names as keys
 */
function getOpenRouterPricingForModels(rawModels, modelNames, currentPricing) {
  const pricing = {};
  
  // Create a map of model ID to model object for quick lookup
  const modelMap = new Map();
  for (const model of rawModels) {
    if (model.id) {
      modelMap.set(model.id, model);
    }
  }
  
  let rerankingModelCount = 0;
  let processedRerankingModels = 0;
  
  for (const modelId of modelNames) {
    // Skip excluded models
    if (isExcludedModel(modelId)) {
      console.log(`[Update Pricing] Skipping excluded OpenRouter model ${modelId} in pricing lookup`);
      continue;
    }
    
    // Check if this is a re-ranking model for logging (declare here so it's available throughout the loop)
    const isReranking = isRerankingModel(modelId);
    if (isReranking) {
      rerankingModelCount++;
      console.log(`[Update Pricing] Found re-ranking model: ${modelId}`);
    }
    
    const model = modelMap.get(modelId);
    if (!model) {
      console.log(`[Update Pricing] Model ${modelId} not found in OpenRouter API response`);
      continue;
    }
    
    // OpenRouter pricing structure: pricing.prompt and pricing.completion (per 1M tokens)
    // Some models may have pricing.prompt_cached for cached tokens
    // Pricing values can be strings or numbers
    const modelPricing = model.pricing;
    if (!modelPricing) {
      console.log(`[Update Pricing] No pricing information for OpenRouter model ${modelId}`);
      continue;
    }
    
    // Debug: Log the pricing structure for first few models to understand the format
    if (Object.keys(pricing).length < 3) {
      console.log(`[Update Pricing] Debug - OpenRouter model ${modelId} pricing structure:`, JSON.stringify(modelPricing, null, 2));
      console.log(`[Update Pricing] Debug - Full model object keys:`, Object.keys(model));
    }
    
    // Transform OpenRouter pricing to our format
    // OpenRouter API returns prices as STRINGS per TOKEN (not per 1M tokens)
    // We need to multiply by 1,000,000 to convert to per 1M tokens
    // Example: "0.0000003" per token = 0.3 per 1M tokens
    const parsePricePerMillion = (value) => {
      if (value === null || value === undefined) return null;
      
      let pricePerToken = null;
      if (typeof value === 'number') {
        pricePerToken = value;
      } else if (typeof value === 'string') {
        const parsed = parseFloat(value);
        if (isNaN(parsed)) return null;
        pricePerToken = parsed;
      } else {
        return null;
      }
      
      // Convert from per-token to per-1M-tokens
      return pricePerToken * 1_000_000;
    };
    
    // OpenRouter API uses these field names:
    // - pricing.prompt (input tokens per token, as string)
    // - pricing.completion (output tokens per token, as string)
    // - pricing.prompt_cached (cached input tokens per token, as string, optional)
    // Note: We need to check if the value exists (not just truthy) because 0 is a valid price
    const getPriceValue = (obj, ...keys) => {
      for (const key of keys) {
        if (key in obj) {
          return obj[key];
        }
      }
      return undefined;
    };
    
    const inputPriceRaw = getPriceValue(
      modelPricing,
      'prompt',
      'input',
      'prompt_price',
      'input_price'
    );
    const outputPriceRaw = getPriceValue(
      modelPricing,
      'completion',
      'output',
      'completion_price',
      'output_price'
    );
    const cachedInputPriceRaw = getPriceValue(
      modelPricing,
      'prompt_cached',
      'cached_input',
      'prompt_cached_price',
      'cached_input_price'
    );
    const requestPriceRaw = getPriceValue(
      modelPricing,
      'request',
      'request_price',
      'per_request',  // Alternative field name
      'perRequest'    // Alternative field name (camelCase)
    );
    
    // Debug logging for re-ranking models and first few models
    if (isReranking || Object.keys(pricing).length < 3) {
      console.log(`[Update Pricing] Debug - ${modelId}${isReranking ? ' (re-ranking)' : ''} raw prices:`, {
        inputPriceRaw,
        outputPriceRaw,
        cachedInputPriceRaw,
        requestPriceRaw,
        pricingKeys: Object.keys(modelPricing),
        fullPricing: isReranking ? JSON.stringify(modelPricing, null, 2) : undefined
      });
    }
    
    // Parse and convert from per-token to per-1M-tokens
    const inputPrice = parsePricePerMillion(inputPriceRaw);
    const outputPrice = parsePricePerMillion(outputPriceRaw);
    const cachedInputPrice = parsePricePerMillion(cachedInputPriceRaw);
    
    // Request pricing is per-request (not per token), so no conversion needed
    // Just parse the value directly
    const parseRequestPrice = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      }
      return null;
    };
    const requestPrice = parseRequestPrice(requestPriceRaw);
    
    // For re-ranking models, allow request-only pricing (input/output can be 0 or missing)
    // For regular models, require both input and output pricing
    if (!isReranking && (inputPrice === null || outputPrice === null)) {
      console.log(`[Update Pricing] Missing required pricing fields for OpenRouter model ${modelId} (pricing: ${JSON.stringify(modelPricing)})`);
      continue;
    }
    
    // For re-ranking models, if request pricing is missing, use a default estimate
    // This allows re-ranking models to be included even if OpenRouter doesn't provide pricing
    if (isReranking && requestPrice === null) {
      console.log(`[Update Pricing] Re-ranking model ${modelId} missing request pricing. Available pricing keys: ${Object.keys(modelPricing).join(", ")}. Full pricing: ${JSON.stringify(modelPricing)}`);
      console.log(`[Update Pricing] Using default request pricing (0.001 USD per request) for re-ranking model ${modelId}`);
    }
    
    // Build pricing structure (no rounding - save exact values)
    const pricingStructure = {};
    
    // For re-ranking models, set input/output to 0 if not provided
    // For regular models, use the parsed prices
    if (isReranking) {
      pricingStructure.input = inputPrice !== null ? inputPrice : 0;
      pricingStructure.output = outputPrice !== null ? outputPrice : 0;
    } else {
      pricingStructure.input = inputPrice;
      pricingStructure.output = outputPrice;
    }
    
    // Add cached input pricing if provided
    // For re-ranking models, skip cached input calculation if input is 0
    if (cachedInputPrice !== null) {
      pricingStructure.cachedInput = cachedInputPrice;
    } else if (!isReranking || pricingStructure.input > 0) {
      // Only calculate cached input if not a re-ranking model, or if re-ranking model has input pricing
      pricingStructure.cachedInput = pricingStructure.input * 0.1; // 10% of input, no rounding
      if (isReranking) {
        console.log(`[Update Pricing] Calculated cachedInput pricing for re-ranking model ${modelId}: ${pricingStructure.cachedInput} (10% of input ${pricingStructure.input})`);
      } else {
        console.log(`[Update Pricing] Calculated cachedInput pricing for ${modelId}: ${pricingStructure.cachedInput} (10% of input ${pricingStructure.input})`);
      }
    }
    
    // Add request pricing if provided (per-request, not per token)
    // For re-ranking models without request pricing, use default estimate
    if (isReranking && requestPrice === null) {
      pricingStructure.request = 0.001; // Default: $0.001 per request
      console.log(`[Update Pricing] Using default request pricing for re-ranking model ${modelId}: 0.001 USD per request`);
    } else if (requestPrice !== null && requestPrice !== 0) {
      pricingStructure.request = requestPrice;
    }
    
    // Skip models with invalid or negative pricing
    if (hasInvalidOrNegativePricing(pricingStructure, isReranking)) {
      console.log(`[Update Pricing] Skipping OpenRouter model ${modelId} due to invalid or negative pricing`);
      continue;
    }
    
    const existingCapabilities =
      currentPricing?.providers?.openrouter?.models?.[modelId]?.capabilities;
    const capabilities = buildOpenRouterCapabilities({
      model,
      isReranking,
      existingCapabilities,
    });

    // Check for tiered pricing (OpenRouter may provide this in the future)
    // For now, we use flat pricing structure
    pricing[modelId] = {
      usd: pricingStructure,
      ...(capabilities ? { capabilities } : {}),
    };
    
    if (isReranking) {
      processedRerankingModels++;
      console.log(`[Update Pricing] Successfully processed re-ranking model ${modelId} with pricing:`, JSON.stringify(pricingStructure));
    }
  }
  
  if (rerankingModelCount > 0) {
    console.log(`[Update Pricing] Re-ranking models summary: Found ${rerankingModelCount} re-ranking models, successfully processed ${processedRerankingModels}`);
  }
  
  return pricing;
}

/**
 * Fetch Google pricing from API and known pricing structure
 * Returns pricing object with model names as keys
 * Also includes models from existing pricing.json that have known pricing
 * (to ensure models not currently in API but with known pricing are still updated)
 * Throws error if fetching fails or no pricing found
 */
async function fetchGooglePricing() {
  console.log("[Update Pricing] Fetching Google models and pricing...");
  
  // Get list of available models from API (throws if fails)
  const models = await getGoogleModels();
  
  if (models.length === 0) {
    throw new Error("No Google models returned from API");
  }

  console.log(`[Update Pricing] Found ${models.length} Google models: ${models.slice(0, 5).join(", ")}${models.length > 5 ? "..." : ""}`);
  
  // Get pricing for available models
  const pricing = getGooglePricingForModels(models);
  
  // Also include models from existing pricing.json that have known pricing
  // This ensures models not currently in API (like gemini-1.5-pro) still get updated
  const pricingPath = join(__dirname, "../apps/backend/src/config/pricing.json");
  const currentPricing = loadPricingFileOrCreateDefault(pricingPath);
  const existingGoogleModels = Object.keys(currentPricing.providers?.google?.models || {});
  if (existingGoogleModels.length > 0) {
    
    // Get all known pricing keys (base models with pricing defined)
    // Derived from knownPricing to ensure they stay in sync
    const knownPricingKeys = Object.keys(knownPricing);
    
    // For each known pricing key, check if we should include it
    for (const knownModel of knownPricingKeys) {
      // Skip excluded models
      if (isExcludedModel(knownModel)) {
        continue;
      }
      
      // Only add if it's not already in pricing (from API models)
      if (!pricing[knownModel]) {
        // Check if it exists in current pricing.json (so we update it)
        // Also filter out excluded models from existing models
        const existsInCurrent = existingGoogleModels.some(
          (m) => !isExcludedModel(m) && (m === knownModel || m.startsWith(knownModel + "-"))
        );
        
        if (existsInCurrent) {
          // Get pricing for this known model
          const modelPricing = getGooglePricingForModels([knownModel]);
          if (modelPricing[knownModel]) {
            pricing[knownModel] = modelPricing[knownModel];
            console.log(`[Update Pricing] Added known pricing for ${knownModel} (not in API but exists in pricing.json)`);
          }
        }
      }
    }
  }
  
  if (Object.keys(pricing).length === 0) {
    throw new Error(`No pricing found for any of the ${models.length} Google models`);
  }
  
  console.log(`[Update Pricing] Google pricing fetched: ${Object.keys(pricing).length} models`);
  return pricing;
}

/**
 * Fetch OpenRouter pricing from API
 * Returns pricing object with model names as keys
 * Also includes models from existing pricing.json that exist in OpenRouter
 * Throws error if fetching fails or no pricing found
 */
async function fetchOpenRouterPricing() {
  console.log("[Update Pricing] Fetching OpenRouter models and pricing...");
  
  // Get list of available models from API (throws if fails)
  const { models, rawModels } = await getOpenRouterModels();
  
  if (models.length === 0) {
    throw new Error("No OpenRouter models returned from API");
  }

  console.log(`[Update Pricing] Found ${models.length} OpenRouter models: ${models.slice(0, 5).join(", ")}${models.length > 5 ? "..." : ""}`);
  
  // Load current pricing for capability merging
  const pricingPath = join(__dirname, "../apps/backend/src/config/pricing.json");
  const currentPricing = loadPricingFileOrCreateDefault(pricingPath);

  // Get pricing for available models
  const pricing = getOpenRouterPricingForModels(rawModels, models, currentPricing);
  
  // Add known re-ranking models (not in /api/v1/models endpoint but available via /api/v1/rerank)
  // Re-ranking models use per-request pricing, not per-token pricing
  const existingOpenRouterModels = Object.keys(currentPricing.providers?.openrouter?.models || {});
  
  // Add known re-ranking models - always include them if they're in the known list
  // This ensures re-ranking models are available even though they're not in the /api/v1/models endpoint
  for (const [modelName, modelPricing] of Object.entries(knownRerankingModels)) {
    // Skip excluded models
    if (isExcludedModel(modelName)) {
      continue;
    }
    
    // Only add if it's not already in pricing (from API models, though re-ranking models won't be there)
    if (!pricing[modelName]) {
      // Deep copy to avoid mutating the original
      const pricingCopy = JSON.parse(JSON.stringify(modelPricing));
      
      // Skip models with invalid or negative pricing
      if (hasInvalidOrNegativePricing(pricingCopy, true)) { // true = isReranking
        console.log(`[Update Pricing] Skipping known re-ranking model ${modelName} due to invalid or negative pricing`);
        continue;
      }
      
      const existingCapabilities =
        currentPricing.providers?.openrouter?.models?.[modelName]?.capabilities;
      const capabilities = buildOpenRouterCapabilities({
        model: undefined,
        isReranking: true,
        existingCapabilities,
      });
      pricing[modelName] = {
        usd: pricingCopy,
        ...(capabilities ? { capabilities } : {}),
      };
      const action = existingOpenRouterModels.includes(modelName) ? "Updated" : "Added";
      console.log(`[Update Pricing] ${action} known re-ranking model ${modelName} with pricing:`, JSON.stringify(pricingCopy));
    }
  }
  
  // Also include models from existing pricing.json that exist in OpenRouter
  // This ensures we update existing models even if they're not in the current API response
  if (existingOpenRouterModels.length > 0) {
    
    // For each existing model, check if it's in the API response but not yet in pricing
    for (const existingModel of existingOpenRouterModels) {
      // Skip excluded models
      if (isExcludedModel(existingModel)) {
        continue;
      }
      
      // Only add if it's not already in pricing (from API models)
      if (!pricing[existingModel]) {
        // Check if it exists in the raw models from API
        const existsInApi = rawModels.some(m => m.id === existingModel);
        
        if (existsInApi) {
          // Get pricing for this model from API
          const modelPricing = getOpenRouterPricingForModels(
            rawModels,
            [existingModel],
            currentPricing
          );
          if (modelPricing[existingModel]) {
            pricing[existingModel] = modelPricing[existingModel];
            console.log(`[Update Pricing] Added pricing for existing OpenRouter model ${existingModel} from API`);
          }
        }
      }
    }
  }
  
  if (Object.keys(pricing).length === 0) {
    throw new Error(`No pricing found for any of the ${models.length} OpenRouter models`);
  }
  
  console.log(`[Update Pricing] OpenRouter pricing fetched: ${Object.keys(pricing).length} models`);
  return pricing;
}

/**
 * Merge fetched pricing into existing pricing structure
 * Supports both flat and tiered pricing structures
 */
function mergePricingIntoConfig(currentPricing, fetchedPricing) {
  const updatedPricing = JSON.parse(JSON.stringify(currentPricing));

  // Ensure providers object exists
  if (!updatedPricing.providers) {
    updatedPricing.providers = {};
  }

  // Merge Google pricing
  if (fetchedPricing.google) {
    if (!updatedPricing.providers.google) {
      updatedPricing.providers.google = { models: {} };
    }
    
    for (const [modelName, pricing] of Object.entries(fetchedPricing.google)) {
      // Skip excluded models
      if (isExcludedModel(modelName)) {
        console.log(`[Update Pricing] Skipping excluded model ${modelName} in merge`);
        continue;
      }
      
      // Skip models with invalid or negative pricing
      if (hasInvalidOrNegativePricing(pricing)) {
        console.log(`[Update Pricing] Skipping Google model ${modelName} in merge due to invalid or negative pricing`);
        continue;
      }
      
      // Ensure pricing structure is valid
      const validPricing = {
        ...pricing,
        // Ensure we have either flat pricing or tiered pricing
        ...(pricing.tiers === undefined && pricing.input === undefined && pricing.output === undefined
          ? { input: 0, output: 0 } // Default fallback
          : {}),
      };

      if (updatedPricing.providers.google.models[modelName]) {
        // Update existing model pricing (USD only)
        updatedPricing.providers.google.models[modelName].usd = validPricing;
        console.log(`[Update Pricing] Updated Google model ${modelName} pricing`);
      } else {
        // Add new model with USD pricing only
        updatedPricing.providers.google.models[modelName] = {
          usd: validPricing,
        };
        console.log(`[Update Pricing] Added new Google model ${modelName} with pricing`);
      }
    }
  }

  // Merge OpenRouter pricing
  if (fetchedPricing.openrouter) {
    if (!updatedPricing.providers.openrouter) {
      updatedPricing.providers.openrouter = { models: {} };
    }
    
    for (const [modelName, pricing] of Object.entries(fetchedPricing.openrouter)) {
      // Skip excluded models
      if (isExcludedModel(modelName)) {
        console.log(`[Update Pricing] Skipping excluded OpenRouter model ${modelName} in merge`);
        continue;
      }
      
      // Check if this is a re-ranking model
      const isReranking = isRerankingModel(modelName);
      const pricingEntry =
        pricing && typeof pricing === "object" ? pricing : {};
      const usdPricing =
        pricingEntry.usd && typeof pricingEntry.usd === "object"
          ? pricingEntry.usd
          : pricing;
      const capabilities =
        pricingEntry.capabilities && typeof pricingEntry.capabilities === "object"
          ? pricingEntry.capabilities
          : undefined;

      // Skip models with invalid or negative pricing
      if (hasInvalidOrNegativePricing(usdPricing, isReranking)) {
        console.log(`[Update Pricing] Skipping OpenRouter model ${modelName} in merge due to invalid or negative pricing`);
        continue;
      }
      
      // Ensure pricing structure is valid
      const validPricing = {
        ...usdPricing,
        // Ensure we have either flat pricing or tiered pricing
        ...(usdPricing.tiers === undefined &&
        usdPricing.input === undefined &&
        usdPricing.output === undefined
          ? { input: 0, output: 0 } // Default fallback
          : {}),
      };

      if (updatedPricing.providers.openrouter.models[modelName]) {
        // Update existing model pricing (USD only)
        updatedPricing.providers.openrouter.models[modelName].usd = validPricing;
        const mergedCapabilities = mergeCapabilities(
          capabilities,
          updatedPricing.providers.openrouter.models[modelName].capabilities
        );
        if (mergedCapabilities) {
          updatedPricing.providers.openrouter.models[modelName].capabilities =
            mergedCapabilities;
        }
        console.log(`[Update Pricing] Updated OpenRouter model ${modelName} pricing`);
      } else {
        // Add new model with USD pricing only
        updatedPricing.providers.openrouter.models[modelName] = {
          usd: validPricing,
          ...(capabilities ? { capabilities } : {}),
        };
        if (capabilities) {
          updatedPricing.providers.openrouter.models[modelName].capabilities =
            capabilities;
        }
        console.log(`[Update Pricing] Added new OpenRouter model ${modelName} with pricing`);
      }
    }
  }

  return updatedPricing;
}

/**
 * Remove excluded models from pricing configuration
 * @param {Object} pricing - Pricing configuration object
 * @returns {Object} Updated pricing configuration with excluded models removed
 */
function removeExcludedModels(pricing) {
  const updatedPricing = JSON.parse(JSON.stringify(pricing));
  
  // Iterate through all providers
  for (const providerName in updatedPricing.providers) {
    const provider = updatedPricing.providers[providerName];
    if (!provider.models) continue;
    
    // Collect excluded model names to remove
    const modelsToRemove = [];
    const allModels = Object.keys(provider.models);
    console.log(`[Update Pricing] Checking ${allModels.length} models in ${providerName} for exclusion...`);
    
    for (const modelName in provider.models) {
      if (isExcludedModel(modelName)) {
        modelsToRemove.push(modelName);
        console.log(`[Update Pricing] Model ${modelName} matches exclusion criteria`);
      }
    }
    
    // Remove excluded models
    if (modelsToRemove.length > 0) {
      for (const modelName of modelsToRemove) {
        delete provider.models[modelName];
        console.log(`[Update Pricing] Removed excluded model ${providerName}/${modelName} from pricing config`);
      }
    } else {
      console.log(`[Update Pricing] No excluded models found in ${providerName}`);
    }
  }
  
  return updatedPricing;
}

/**
 * Remove models with invalid or negative pricing from pricing configuration
 * @param {Object} pricing - Pricing configuration object
 * @returns {Object} Updated pricing configuration with invalid/negative pricing models removed
 */
function removeInvalidOrNegativePricingModels(pricing) {
  const updatedPricing = JSON.parse(JSON.stringify(pricing));
  
  // Iterate through all providers
  for (const providerName in updatedPricing.providers) {
    const provider = updatedPricing.providers[providerName];
    if (!provider.models) continue;
    
    // Collect models with invalid or negative pricing to remove
    const modelsToRemove = [];
    const allModels = Object.keys(provider.models);
    console.log(`[Update Pricing] Checking ${allModels.length} models in ${providerName} for invalid or negative pricing...`);
    
    for (const modelName in provider.models) {
      const model = provider.models[modelName];
      if (!model || typeof model !== 'object') continue;
      
      const usdPricing = model.usd;
      
      // Check if this is a re-ranking model
      const isReranking = isRerankingModel(modelName);
      
      if (usdPricing && hasInvalidOrNegativePricing(usdPricing, isReranking)) {
        modelsToRemove.push(modelName);
        console.log(`[Update Pricing] Model ${providerName}/${modelName} has invalid or negative pricing and will be removed:`, JSON.stringify(usdPricing));
      }
    }
    
    // Remove models with invalid or negative pricing
    if (modelsToRemove.length > 0) {
      for (const modelName of modelsToRemove) {
        delete provider.models[modelName];
        console.log(`[Update Pricing] Removed model ${providerName}/${modelName} with invalid or negative pricing from pricing config`);
      }
    } else {
      console.log(`[Update Pricing] No models with invalid or negative pricing found in ${providerName}`);
    }
  }
  
  return updatedPricing;
}

/**
 * Update pricing configuration with USD prices only
 * No exchange rate conversion - only USD pricing is maintained
 */
async function updatePricingWrapper() {
  console.log("[Update Pricing] Updating USD pricing...");

  // Load current pricing (or use default if file doesn't exist)
  const pricingPath = join(__dirname, "../apps/backend/src/config/pricing.json");
  const currentPricing = loadPricingFileOrCreateDefault(pricingPath);

  // Fetch pricing from Google (throws if fails)
  let googlePricing = {};
  try {
    googlePricing = await fetchGooglePricing();
  } catch (error) {
    console.error("[Update Pricing] Failed to fetch Google pricing:", error.message);
    // Continue with OpenRouter pricing even if Google fails
  }

  // Fetch pricing from OpenRouter (throws if fails)
  let openRouterPricing = {};
  try {
    openRouterPricing = await fetchOpenRouterPricing();
  } catch (error) {
    console.error("[Update Pricing] Failed to fetch OpenRouter pricing:", error.message);
    // Continue with Google pricing even if OpenRouter fails
  }

  // If both providers failed, throw error
  if (Object.keys(googlePricing).length === 0 && Object.keys(openRouterPricing).length === 0) {
    throw new Error("Failed to fetch pricing from both Google and OpenRouter");
  }

  const fetchedPricing = {
    google: googlePricing,
    openrouter: openRouterPricing,
  };

  // Merge fetched pricing into current pricing (only updates USD prices)
  const pricingWithFetched = mergePricingIntoConfig(currentPricing, fetchedPricing);

  // Remove any excluded models that exist in the pricing configuration
  const pricingWithoutExcluded = removeExcludedModels(pricingWithFetched);

  // Remove any models with invalid or negative pricing
  const finalPricing = removeInvalidOrNegativePricingModels(pricingWithoutExcluded);

  return finalPricing;
}

/**
 * Check if there are any excluded models in the pricing configuration
 * @param {Object} pricing - Pricing configuration object
 * @returns {boolean} True if any excluded models exist
 */
function hasExcludedModels(pricing) {
  for (const providerName in pricing.providers || {}) {
    const provider = pricing.providers[providerName];
    if (!provider.models) continue;
    
    for (const modelName in provider.models) {
      if (isExcludedModel(modelName)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Deep equality check for two values, ignoring lastUpdated field
 * @param {*} a - First value to compare
 * @param {*} b - Second value to compare
 * @returns {boolean} True if values are deeply equal
 */
function deepEqual(a, b) {
  // Handle null/undefined
  if (a === null || a === undefined) {
    return b === null || b === undefined;
  }
  if (b === null || b === undefined) {
    return false;
  }

  // Handle primitives
  if (typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }

  // Handle arrays
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  // Handle objects - get all keys except lastUpdated
  const aKeys = Object.keys(a).filter(key => key !== 'lastUpdated');
  const bKeys = Object.keys(b).filter(key => key !== 'lastUpdated');

  if (aKeys.length !== bKeys.length) {
    return false;
  }

  // Check that all keys in a exist in b and have equal values
  for (const key of aKeys) {
    if (!(key in b)) {
      return false;
    }
    if (!deepEqual(a[key], b[key])) {
      return false;
    }
  }

  // Also check that all keys in b exist in a (defensive check)
  // This ensures we catch cases where b has keys that a doesn't have
  for (const key of bKeys) {
    if (!(key in a)) {
      return false;
    }
  }

  return true;
}

/**
 * Deep compare two pricing objects (ignoring lastUpdated)
 * @param {Object} oldPricing - Old pricing configuration
 * @param {Object} newPricing - New pricing configuration
 * @returns {boolean} True if pricing has changed
 */
function pricingChanged(oldPricing, newPricing) {
  return !deepEqual(oldPricing, newPricing);
}

/**
 * Update pricing configuration file
 */
async function updatePricingConfig() {
  try {
    // Validate required API keys before proceeding
    validateRequiredApiKeys();
    
    console.log("[Update Pricing] Starting pricing update...");

    // Load current pricing (or use default if file doesn't exist)
    const configPath = join(__dirname, "../apps/backend/src/config/pricing.json");
    const currentPricing = loadPricingFileOrCreateDefault(configPath);

    // Check if there are excluded models that need to be removed
    const hasExcluded = hasExcludedModels(currentPricing);
    if (hasExcluded) {
      console.log("[Update Pricing] Excluded models detected in current pricing, will be removed.");
    }

    // Update pricing (USD only)
    const newPricing = await updatePricingWrapper();

    // Log model counts for debugging
    const oldGoogleModelCount = Object.keys(currentPricing.providers?.google?.models || {}).length;
    const newGoogleModelCount = Object.keys(newPricing.providers?.google?.models || {}).length;
    const googleModelsWereRemoved = oldGoogleModelCount > newGoogleModelCount;
    
    const oldOpenRouterModelCount = Object.keys(currentPricing.providers?.openrouter?.models || {}).length;
    const newOpenRouterModelCount = Object.keys(newPricing.providers?.openrouter?.models || {}).length;
    const openRouterModelsWereRemoved = oldOpenRouterModelCount > newOpenRouterModelCount;
    
    console.log(`[Update Pricing] Google model count: ${oldGoogleModelCount} -> ${newGoogleModelCount}`);
    if (googleModelsWereRemoved) {
      console.log(`[Update Pricing] ${oldGoogleModelCount - newGoogleModelCount} Google model(s) were removed.`);
    }
    
    console.log(`[Update Pricing] OpenRouter model count: ${oldOpenRouterModelCount} -> ${newOpenRouterModelCount}`);
    if (openRouterModelsWereRemoved) {
      console.log(`[Update Pricing] ${oldOpenRouterModelCount - newOpenRouterModelCount} OpenRouter model(s) were removed.`);
    }

    // Final cleanup: Remove any models with invalid or negative pricing (safety check)
    const finalCleanedPricing = removeInvalidOrNegativePricingModels(newPricing);
    
    // Check if pricing actually changed using deep equality (ignoring lastUpdated)
    const pricingHasChanged = pricingChanged(currentPricing, finalCleanedPricing);
    
    if (!pricingHasChanged) {
      console.log("[Update Pricing] No pricing changes detected (deep equality check). Exiting.");
      return;
    }

    console.log("[Update Pricing] Pricing changes detected. Updating file...");

    // Ensure directory exists before writing
    const configDir = dirname(configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
      console.log(`[Update Pricing] Created directory: ${configDir}`);
    }

    // Set lastUpdated timestamp
    finalCleanedPricing.lastUpdated = new Date().toISOString();

    // Write to config file
    writeFileSync(configPath, JSON.stringify(finalCleanedPricing, null, 2), "utf-8");

    console.log("[Update Pricing] Pricing file updated:", {
      lastUpdated: finalCleanedPricing.lastUpdated,
      providerCount: Object.keys(finalCleanedPricing.providers || {}).length,
      googleModels: Object.keys(finalCleanedPricing.providers?.google?.models || {}).length,
      openRouterModels: Object.keys(finalCleanedPricing.providers?.openrouter?.models || {}).length,
    });

    console.log("[Update Pricing] Pricing update completed successfully");
  } catch (error) {
    console.error("[Update Pricing] Error updating pricing:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updatePricingConfig();
}

