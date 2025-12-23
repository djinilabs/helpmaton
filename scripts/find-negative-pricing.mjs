import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Check if a price value is invalid (negative, undefined, null, NaN, or non-number)
 */
function isInvalidPrice(value) {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value !== 'number') {
    return true;
  }
  if (isNaN(value)) {
    return true;
  }
  if (value < 0) {
    return true;
  }
  return false;
}

/**
 * Check if pricing structure contains any invalid or negative prices
 */
function hasInvalidOrNegativePricing(pricing) {
  if (!pricing || typeof pricing !== 'object') {
    return false;
  }

  // Handle flat pricing
  if (pricing.input !== undefined || pricing.output !== undefined) {
    if (isInvalidPrice(pricing.input) || isInvalidPrice(pricing.output)) {
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

  // Handle tiered pricing
  if (pricing.tiers && Array.isArray(pricing.tiers)) {
    for (const tier of pricing.tiers) {
      if (!tier || typeof tier !== 'object') continue;
      
      if (isInvalidPrice(tier.input) || isInvalidPrice(tier.output)) {
        return true;
      }
      if (tier.cachedInput !== undefined && isInvalidPrice(tier.cachedInput)) {
        return true;
      }
      if (tier.reasoning !== undefined && isInvalidPrice(tier.reasoning)) {
        return true;
      }
    }
    return false;
  }

  return false;
}

// Load pricing.json
const pricingPath = join(__dirname, "../apps/backend/src/config/pricing.json");
const pricing = JSON.parse(readFileSync(pricingPath, "utf-8"));

console.log("Scanning for models with invalid or negative pricing...\n");

let foundAny = false;

for (const providerName in pricing.providers || {}) {
  const provider = pricing.providers[providerName];
  if (!provider.models) continue;
  
  for (const modelName in provider.models) {
    const model = provider.models[modelName];
    if (!model || typeof model !== 'object') continue;
    
    const usdPricing = model.usd;
    
    if (usdPricing && hasInvalidOrNegativePricing(usdPricing)) {
      foundAny = true;
      console.log(`❌ ${providerName}/${modelName}:`);
      console.log(`   Pricing: ${JSON.stringify(usdPricing, null, 2)}`);
      console.log();
    }
  }
}

if (!foundAny) {
  console.log("✅ No models with invalid or negative pricing found.");
} else {
  console.log("\n⚠️  Found models with invalid or negative pricing. Run the update script to remove them.");
}

