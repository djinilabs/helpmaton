/**
 * Router entrypoint for Lambda container images (CommonJS version)
 * Routes to the correct handler based on LAMBDA_HANDLER_PATH environment variable
 * This allows a single Docker image to support multiple Lambda functions
 * 
 * Uses CommonJS for compatibility, then dynamically imports ES modules
 */

// Lambda sets AWS_LAMBDA_FUNCTION_NAME automatically
const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME || '';
const handlerPath = process.env.LAMBDA_HANDLER_PATH || 'index.handler';

console.log(`[router] Function: ${functionName}, Handler path: ${handlerPath}`);

// Parse handler path: "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
// -> module: "http/any-api-streams-000workspaceId-000agentId-000secret/index"
// -> export: "handler"
const [modulePath, exportName = 'handler'] = handlerPath.split('.');

// Cache the handler module to avoid re-importing on every invocation
let cachedHandler = null;

// Load handler module using dynamic import (ES modules)
// We use a wrapper function that loads the handler on first invocation
async function loadHandler() {
  if (cachedHandler) {
    return cachedHandler;
  }

  try {
    // Import the handler module (ES module)
    const handlerModule = await import(`./${modulePath}.js`);
    cachedHandler = handlerModule[exportName] || handlerModule.default || handlerModule.handler;
    
    if (!cachedHandler || typeof cachedHandler !== 'function') {
      throw new Error(`Handler export "${exportName}" not found or is not a function in ${modulePath}`);
    }
    
    console.log(`[router] Successfully loaded handler from ${modulePath}.${exportName}`);
    return cachedHandler;
  } catch (error) {
    console.error(`[router] Failed to load handler from ${modulePath}.${exportName}:`, error);
    console.error(`[router] Error stack:`, error.stack);
    throw error;
  }
}

// Export a wrapper handler that loads and calls the actual handler (CommonJS)
module.exports.handler = async (event, context) => {
  const actualHandler = await loadHandler();
  return actualHandler(event, context);
};
