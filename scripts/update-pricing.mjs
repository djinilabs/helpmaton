import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
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
  "-image",         // Image generation models (e.g., gemini-2.5-flash-image, gemini-2.0-flash-exp-image-generation)
  "image-",         // Image generation models with prefix
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
 * Validate that all required API keys are defined
 * Throws an error and exits if any are missing
 */
function validateRequiredApiKeys() {
  const requiredKeys = [
    { name: "GEMINI_API_KEY", env: process.env.GEMINI_API_KEY },
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
 * Fetch exchange rates from European Central Bank via Frankfurter.app API
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @returns {Promise<{usd: number, gbp: number}>} Exchange rates relative to EUR
 * @throws {Error} If exchange rates cannot be fetched after retries
 */
async function fetchExchangeRates(maxRetries = 3) {
  const apiUrl = "https://api.frankfurter.app/latest?from=EUR";
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Update Pricing] Fetching exchange rates (attempt ${attempt + 1}/${maxRetries + 1})...`);

      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Exchange rate API returned status ${response.status}: ${response.statusText}`
        );
      }

      const data = await response.json();

      // Validate response structure
      if (!data.rates || typeof data.rates !== "object") {
        throw new Error("Invalid exchange rate API response: missing or invalid rates");
      }

      // Extract USD and GBP rates
      const usdRate = data.rates.USD;
      const gbpRate = data.rates.GBP;

      if (typeof usdRate !== "number" || typeof gbpRate !== "number") {
        throw new Error(
          `Invalid exchange rates: USD=${usdRate}, GBP=${gbpRate}`
        );
      }

      if (usdRate <= 0 || gbpRate <= 0) {
        throw new Error(
          `Invalid exchange rates: rates must be positive (USD=${usdRate}, GBP=${gbpRate})`
        );
      }

      console.log("[Update Pricing] Exchange rates fetched successfully:", {
        usd: usdRate,
        gbp: gbpRate,
        date: data.date,
      });

      return { usd: usdRate, gbp: gbpRate };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = 1000 * Math.pow(2, attempt);
        console.warn(
          `[Update Pricing] Failed to fetch exchange rates, retrying in ${backoffMs}ms:`,
          lastError.message
        );
        await sleep(backoffMs);
      }
    }
  }

  // If we get here, all retries failed
  throw new Error(
    `Failed to fetch exchange rates after ${maxRetries + 1} attempts: ${lastError?.message || "Unknown error"}`
  );
}

/**
 * Round to 3 decimal places (matching pricing.json precision)
 */
function roundPrice(price) {
  return Math.round(price * 1000) / 1000;
}

/**
 * Convert pricing structure (flat or tiered) to EUR/GBP using exchange rates
 * @param {Object} usdPricing - USD pricing structure (flat or tiered)
 * @param {{usd: number, gbp: number}} exchangeRates - Exchange rates relative to EUR
 * @returns {Object} Pricing structure with EUR and GBP converted
 */
function convertPricingToOtherCurrencies(usdPricing, exchangeRates) {
  const { usd: eurToUsdRate, gbp: eurToGbpRate } = exchangeRates;

  // Handle flat pricing (backward compatible)
  if (usdPricing.input !== undefined || usdPricing.output !== undefined) {
    const usdInput = usdPricing.input ?? 0;
    const usdOutput = usdPricing.output ?? 0;
    const usdReasoning = usdPricing.reasoning;
    const usdCachedInput = usdPricing.cachedInput;

    const eurInput = roundPrice(usdInput / eurToUsdRate);
    const eurOutput = roundPrice(usdOutput / eurToUsdRate);
    const eurReasoning = usdReasoning !== undefined
      ? roundPrice(usdReasoning / eurToUsdRate)
      : undefined;
    const eurCachedInput = usdCachedInput !== undefined
      ? roundPrice(usdCachedInput / eurToUsdRate)
      : undefined;

    const gbpInput = roundPrice((usdInput / eurToUsdRate) * eurToGbpRate);
    const gbpOutput = roundPrice((usdOutput / eurToUsdRate) * eurToGbpRate);
    const gbpReasoning = usdReasoning !== undefined
      ? roundPrice((usdReasoning / eurToUsdRate) * eurToGbpRate)
      : undefined;
    const gbpCachedInput = usdCachedInput !== undefined
      ? roundPrice((usdCachedInput / eurToUsdRate) * eurToGbpRate)
      : undefined;

    return {
      eur: {
        input: eurInput,
        output: eurOutput,
        ...(eurReasoning !== undefined && { reasoning: eurReasoning }),
        ...(eurCachedInput !== undefined && { cachedInput: eurCachedInput }),
      },
      gbp: {
        input: gbpInput,
        output: gbpOutput,
        ...(gbpReasoning !== undefined && { reasoning: gbpReasoning }),
        ...(gbpCachedInput !== undefined && { cachedInput: gbpCachedInput }),
      },
    };
  }

  // Handle tiered pricing
  if (usdPricing.tiers && Array.isArray(usdPricing.tiers)) {
    const eurTiers = usdPricing.tiers.map((tier) => ({
      threshold: tier.threshold,
      input: roundPrice(tier.input / eurToUsdRate),
      output: roundPrice(tier.output / eurToUsdRate),
      ...(tier.reasoning !== undefined && {
        reasoning: roundPrice(tier.reasoning / eurToUsdRate),
      }),
      ...(tier.cachedInput !== undefined && {
        cachedInput: roundPrice(tier.cachedInput / eurToUsdRate),
      }),
    }));

    const gbpTiers = usdPricing.tiers.map((tier) => ({
      threshold: tier.threshold,
      input: roundPrice((tier.input / eurToUsdRate) * eurToGbpRate),
      output: roundPrice((tier.output / eurToUsdRate) * eurToGbpRate),
      ...(tier.reasoning !== undefined && {
        reasoning: roundPrice((tier.reasoning / eurToUsdRate) * eurToGbpRate),
      }),
      ...(tier.cachedInput !== undefined && {
        cachedInput: roundPrice((tier.cachedInput / eurToUsdRate) * eurToGbpRate),
      }),
    }));

    return {
      eur: { tiers: eurTiers },
      gbp: { tiers: gbpTiers },
    };
  }

  // Unknown structure
  return {
    eur: {},
    gbp: {},
  };
}

/**
 * Update pricing with exchange rates, keeping USD prices unchanged
 * Supports both flat and tiered pricing structures
 * @param {Object} currentPricing - Current pricing configuration
 * @param {{usd: number, gbp: number}} exchangeRates - Exchange rates relative to EUR
 * @returns {Object} Updated pricing configuration
 */
function updatePricingWithExchangeRates(currentPricing, exchangeRates) {
  // Create a deep copy to avoid mutating the original
  const updatedPricing = JSON.parse(JSON.stringify(currentPricing));

  // Iterate through all providers and models
  for (const providerName in updatedPricing.providers) {
    const provider = updatedPricing.providers[providerName];
    if (!provider.models) continue;

    for (const modelName in provider.models) {
      // Skip excluded models
      if (isExcludedModel(modelName)) {
        console.log(`[Update Pricing] Skipping excluded model ${providerName}/${modelName} in exchange rate update`);
        continue;
      }
      
      const model = provider.models[modelName];
      if (!model.usd) {
        console.warn(
          `[Update Pricing] Model ${providerName}/${modelName} missing USD pricing, skipping`
        );
        continue;
      }

      // Convert USD pricing to EUR and GBP
      const converted = convertPricingToOtherCurrencies(model.usd, exchangeRates);
      model.eur = converted.eur;
      model.gbp = converted.gbp;

      console.log(`[Update Pricing] Updated ${providerName}/${modelName}:`, {
        usd: model.usd,
        eur: model.eur,
        gbp: model.gbp,
      });
    }
  }

  // Update timestamp
  updatedPricing.lastUpdated = new Date().toISOString();

  return updatedPricing;
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
      pricing[modelId] = pricingCopy;
    }
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
  if (existsSync(pricingPath)) {
    const currentPricing = JSON.parse(readFileSync(pricingPath, "utf-8"));
    const existingGoogleModels = Object.keys(currentPricing.providers?.google?.models || {});
    
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
 * Merge fetched pricing into existing pricing structure
 * Supports both flat and tiered pricing structures
 */
function mergePricingIntoConfig(currentPricing, fetchedPricing) {
  const updatedPricing = JSON.parse(JSON.stringify(currentPricing));

  // Merge Google pricing
  if (fetchedPricing.google && updatedPricing.providers.google) {
    for (const [modelName, pricing] of Object.entries(fetchedPricing.google)) {
      // Skip excluded models
      if (isExcludedModel(modelName)) {
        console.log(`[Update Pricing] Skipping excluded model ${modelName} in merge`);
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
        // Update existing model pricing (USD only, EUR/GBP will be updated by exchange rate function)
        updatedPricing.providers.google.models[modelName].usd = validPricing;
        console.log(`[Update Pricing] Updated Google model ${modelName} pricing`);
      } else {
        // Add new model with USD pricing, EUR/GBP to be filled in by exchange rate update
        updatedPricing.providers.google.models[modelName] = {
          usd: validPricing,
          eur: {},
          gbp: {},
        };
        console.log(`[Update Pricing] Added new Google model ${modelName} with pricing`);
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
 * Update pricing configuration with current exchange rates
 * Keeps USD prices unchanged and updates EUR/GBP prices based on ECB exchange rates
 */
async function updatePricingWithExchangeRatesWrapper() {
  console.log("[Update Pricing] Fetching exchange rates and updating pricing...");

  // Load current pricing
  const pricingPath = join(__dirname, "../apps/backend/src/config/pricing.json");
  let currentPricing = JSON.parse(readFileSync(pricingPath, "utf-8"));

  // Fetch pricing from Google (throws if fails)
  const googlePricing = await fetchGooglePricing();

  const fetchedPricing = {
    google: googlePricing,
  };

  // Merge fetched pricing into current pricing (only updates USD prices)
  const pricingWithFetched = mergePricingIntoConfig(currentPricing, fetchedPricing);
  // Use merged pricing for exchange rate conversion
  currentPricing = pricingWithFetched;

  // Fetch exchange rates (will throw if it fails - per user requirement to fail and exit)
  const exchangeRates = await fetchExchangeRates();

  // Update pricing with new exchange rates
  const updatedPricing = updatePricingWithExchangeRates(currentPricing, exchangeRates);

  // Remove any excluded models that exist in the pricing configuration
  const finalPricing = removeExcludedModels(updatedPricing);

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
 * Commit and push pricing changes
 */
function commitAndPushChanges(date) {
  try {
    const relativePath = "apps/backend/src/config/pricing.json";
    
    // Stage the pricing file
    execSync(`git add "${relativePath}"`, { encoding: "utf-8" });
    console.log("[Update Pricing] Staged pricing.json");

    // Check if there are actually changes to commit
    // git diff --cached --quiet returns exit code 0 if no changes, 1 if there are changes
    try {
      execSync(`git diff --cached --quiet "${relativePath}"`, { encoding: "utf-8" });
      // If we get here, there are no changes
      console.log("[Update Pricing] No changes to commit after staging");
      return false;
    } catch (error) {
      // Exit code 1 means there are changes, which is what we want
      // Continue with commit
    }

    // Commit with the specified message format
    const commitMessage = `chore: update pricing for tokens: ${date}`;
    execSync(`git commit -m "${commitMessage}"`, { encoding: "utf-8" });
    console.log("[Update Pricing] Committed changes:", commitMessage);

    // Push to main branch
    // In GitHub Actions, the checkout action with token already configures git to use the token
    // For local runs, this will use existing git credentials
    // Note: This requires write access to main branch. If branch protection is enabled,
    // the workflow may need additional permissions or the repository settings may need adjustment.
    const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    if (currentBranch === "main") {
      execSync("git push origin main", { encoding: "utf-8" });
    } else {
      // In GitHub Actions, we're typically on a detached HEAD, so push directly to main
      execSync("git push origin HEAD:main", { encoding: "utf-8" });
    }
    
    console.log("[Update Pricing] Pushed changes to main branch");
    return true;
  } catch (error) {
    console.error("[Update Pricing] Error committing/pushing changes:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

/**
 * Update pricing configuration file
 */
async function updatePricingConfig() {
  try {
    // Validate required API keys before proceeding
    validateRequiredApiKeys();
    
    console.log("[Update Pricing] Starting pricing update...");

    // Load current pricing
    const configPath = join(__dirname, "../apps/backend/src/config/pricing.json");
    const currentPricing = JSON.parse(readFileSync(configPath, "utf-8"));

    // Check if there are excluded models that need to be removed
    const hasExcluded = hasExcludedModels(currentPricing);
    if (hasExcluded) {
      console.log("[Update Pricing] Excluded models detected in current pricing, will be removed.");
    }

    // Fetch exchange rates and update pricing
    const newPricing = await updatePricingWithExchangeRatesWrapper();

    // Log model counts for debugging
    const oldModelCount = Object.keys(currentPricing.providers?.google?.models || {}).length;
    const newModelCount = Object.keys(newPricing.providers?.google?.models || {}).length;
    const modelsWereRemoved = oldModelCount > newModelCount;
    
    console.log(`[Update Pricing] Model count: ${oldModelCount} -> ${newModelCount}`);
    if (modelsWereRemoved) {
      console.log(`[Update Pricing] ${oldModelCount - newModelCount} model(s) were removed.`);
    }

    // Check if pricing actually changed using deep equality (ignoring lastUpdated)
    const pricingHasChanged = pricingChanged(currentPricing, newPricing);
    
    if (!pricingHasChanged) {
      console.log("[Update Pricing] No pricing changes detected (deep equality check). Exiting.");
      return;
    }

    console.log("[Update Pricing] Pricing changes detected. Updating file...");

    // Write to config file
    writeFileSync(configPath, JSON.stringify(newPricing, null, 2), "utf-8");

    console.log("[Update Pricing] Pricing file updated:", {
      lastUpdated: newPricing.lastUpdated,
      providerCount: Object.keys(newPricing.providers || {}).length,
      models: Object.keys(newPricing.providers?.google?.models || {}).length,
    });

    // Commit and push changes
    const date = new Date().toISOString(); // Full ISO format
    await commitAndPushChanges(date);

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
updatePricingConfig();

