/**
 * Router entrypoint for Lambda container images
 * Routes to the correct handler based on LAMBDA_HANDLER_PATH environment variable
 */

console.log('[index.js] Module loading...');

// Get handler path from environment
const handlerPath = process.env.LAMBDA_HANDLER_PATH || 'index.handler';
console.log(`[index.js] Handler path from env: ${handlerPath}`);

// Parse handler path: "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
// -> module: "http/any-api-streams-000workspaceId-000agentId-000secret/index"
// -> export: "handler"
const [modulePath, exportName = 'handler'] = handlerPath.split('.');
console.log(`[index.js] Parsed - module: ${modulePath}, export: ${exportName}`);

// Cache the handler module
let cachedHandler = null;

// Load handler module using dynamic import (ES modules)
async function loadHandler() {
  if (cachedHandler) {
    console.log('[index.js] Using cached handler');
    return cachedHandler;
  }

  try {
    console.log(`[index.js] Loading handler from ./${modulePath}.js...`);
    const handlerModule = await import(`./${modulePath}.js`);
    console.log(`[index.js] Module loaded, looking for export: ${exportName}`);
    cachedHandler = handlerModule[exportName] || handlerModule.default || handlerModule.handler;
    
    if (!cachedHandler || typeof cachedHandler !== 'function') {
      throw new Error(`Handler export "${exportName}" not found or is not a function in ${modulePath}`);
    }
    
    console.log(`[index.js] Successfully loaded handler from ${modulePath}.${exportName}`);
    return cachedHandler;
  } catch (error) {
    console.error(`[index.js] Failed to load handler from ${modulePath}.${exportName}:`, error);
    console.error(`[index.js] Error message:`, error.message);
    console.error(`[index.js] Error stack:`, error.stack);
    throw error;
  }
}

// Export handler using both formats for maximum compatibility
// Lambda needs to find this synchronously at module load time
exports.handler = async (event, context) => {
  console.log('[index.js] Handler invoked');
  const actualHandler = await loadHandler();
  console.log('[index.js] Calling actual handler...');
  return actualHandler(event, context);
};

// Also export via module.exports for CommonJS compatibility
module.exports.handler = exports.handler;

console.log('[index.js] Module loaded, handler exported');
