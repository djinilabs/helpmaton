/**
 * Router entrypoint for Lambda container images
 * Routes to the correct handler based on LAMBDA_HANDLER_PATH environment variable
 */

// Get handler path from environment
const handlerPath = process.env.LAMBDA_HANDLER_PATH || 'index.handler';
console.log(`[index.js] Handler path: ${handlerPath}`);

// Parse handler path: "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
// -> module: "http/any-api-streams-000workspaceId-000agentId-000secret/index"
// -> export: "handler"
const [modulePath, exportName = 'handler'] = handlerPath.split('.');

// Cache the handler module
let cachedHandler = null;

// Load handler module using dynamic import (ES modules)
// We must use async import since dist files are ES modules
async function loadHandler() {
  if (cachedHandler) {
    return cachedHandler;
  }

  try {
    console.log(`[index.js] Loading handler from ${modulePath}.${exportName}...`);
    const handlerModule = await import(`./${modulePath}.js`);
    cachedHandler = handlerModule[exportName] || handlerModule.default || handlerModule.handler;
    
    if (!cachedHandler || typeof cachedHandler !== 'function') {
      throw new Error(`Handler export "${exportName}" not found or is not a function in ${modulePath}`);
    }
    
    console.log(`[index.js] Successfully loaded handler from ${modulePath}.${exportName}`);
    return cachedHandler;
  } catch (error) {
    console.error(`[index.js] Failed to load handler from ${modulePath}.${exportName}:`, error);
    console.error(`[index.js] Error stack:`, error.stack);
    throw error;
  }
}

// Export handler - must be a function for Lambda to find it
// The function will load the actual handler on first invocation
module.exports.handler = async (event, context) => {
  const actualHandler = await loadHandler();
  return actualHandler(event, context);
};
