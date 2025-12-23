/**
 * esbuild configuration for Architect Lambda functions
 * 
 * This configuration injects environment variables directly into Lambda bundles
 * at build time using esbuild's `define` option. This replaces `process.env.VAR_NAME`
 * with actual string values, effectively hardcoding them into the compiled code.
 * 
 * This approach ensures each PR deployment has isolated environment variables
 * without relying on SSM Parameter Store, which would be shared across all staging deployments.
 */

// List of environment variables that should be injected into bundles
// Only variables explicitly set in the environment will be injected
const ENV_VARS_TO_INJECT = [
  'ARC_ENV',
  'NODE_ENV',
  'AUTH_SECRET',
  'MAILGUN_KEY',
  'MAILGUN_DOMAIN',
  'BASE_URL',
  'FRONTEND_URL',
  'OAUTH_REDIRECT_BASE_URL',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'HELPMATON_CUSTOM_DOMAIN',
  'HELPMATON_S3_BUCKET',
  'HELPMATON_S3_ENDPOINT',
  'HELPMATON_S3_ACCESS_KEY_ID',
  'HELPMATON_S3_SECRET_ACCESS_KEY',
  'HELPMATON_S3_REGION',
  'SENTRY_DSN',
  'POSTHOG_API_KEY',
  'POSTHOG_API_HOST',
  'CLOUDFLARE_TURNSTILE_SECRET_KEY',
  'CLOUDFLARE_TURNSTILE_SITE_KEY',
  'DISCORD_BOT_TOKEN',
  'DISCORD_PUBLIC_KEY',
  'DISCORD_CS_USERS',
  'DISCORD_TRIAL_CREDIT_CHANNEL_ID',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'OUTLOOK_CLIENT_ID',
  'OUTLOOK_CLIENT_SECRET',
  'ENABLE_CREDIT_VALIDATION',
  'ENABLE_CREDIT_DEDUCTION',
  'ENABLE_SPENDING_LIMIT_CHECKS',
  'ALLOWED_EMAILS',
  'RESTRICT_LOGIN_TO_WHITELIST',
  'AWS_CERTIFICATE_ARN',
  'AWS_ZONE_ID',
  'HTTP_TO_REST_MIGRATION',
  'HTTP_TO_REST_MIGRATION_PHASE',
  'DEBUG_TEMPLATE',
  'DEFAULT_REFERER',
  'LEMON_SQUEEZY_API_KEY',
  'LEMON_SQUEEZY_WEBHOOK_SECRET',
  'LEMON_SQUEEZY_STORE_ID',
  'LEMON_SQUEEZY_STARTER_VARIANT_ID',
  'LEMON_SQUEEZY_PRO_VARIANT_ID',
  'LEMON_SQUEEZY_CREDIT_VARIANT_ID',
  'LEMON_SQUEEZY_CHECKOUT_SUCCESS_URL',
  'LEMON_SQUEEZY_CHECKOUT_CANCEL_URL',
  'HELPMATON_VECTORDB_S3_BUCKET_STAGING',
  'HELPMATON_VECTORDB_S3_BUCKET_PRODUCTION',
  'E2E_OVERRIDE_MAX_USERS',
];

/**
 * Build the define object for esbuild
 * Only includes environment variables that are explicitly set
 */
function buildDefine() {
  const define = {};
  const arcEnv = process.env.ARC_ENV || process.env.NODE_ENV;

  // In local development, we may want to skip injection to allow runtime env vars
  // However, for consistency and to test the build process, we'll still inject if values are set
  // Unset variables will simply not be replaced, allowing process.env to work normally

  for (const varName of ENV_VARS_TO_INJECT) {
    const value = process.env[varName];
    
    // Only inject if the variable is explicitly set
    if (value !== undefined && value !== null) {
      // Use JSON.stringify to properly escape the value and handle special characters
      // This ensures the value is correctly embedded as a string literal in the code
      // Note: esbuild's define only supports dot notation (process.env.VAR_NAME),
      // not bracket notation (process.env['VAR_NAME'] or process.env["VAR_NAME"])
      define[`process.env.${varName}`] = JSON.stringify(value);
    }
  }

  return define;
}

// Build the config object with error handling
let defineObject = {};
try {
  defineObject = buildDefine();
} catch (error) {
  console.warn('[esbuild-config] Error building define object:', error);
  // Fallback to empty define object if there's an error
  defineObject = {};
}

const config = {
  loader: {
    '.graphqls': 'text',
  },
  sourcemap: false,
  sourcesContent: false,
  define: defineObject,
  external: [
    // LanceDB native modules - resolved at runtime in Lambda container
    '@lancedb/lancedb',
    '@lancedb/lancedb-darwin-arm64',
    '@lancedb/lancedb-darwin-x64',
    '@lancedb/lancedb-linux-arm64',
    '@lancedb/lancedb-linux-x64',
    '@lancedb/lancedb-win32-x64',
    '@lancedb/*',
    // Native .node files
    '*.node',
  ],
};

// Export as both function and object to support different usage patterns
// Architect's plugin-typescript may call it as a function or use it as an object
function esbuildConfig(options = {}) {
  return {
    ...config,
    ...options, // Allow options to override defaults if needed
  };
}

// Copy config properties to the function for object-style access
Object.assign(esbuildConfig, config);

module.exports = esbuildConfig;

