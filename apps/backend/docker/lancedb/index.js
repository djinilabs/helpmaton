/**
 * Router entrypoint for Lambda container images
 * Routes to the correct handler based on LAMBDA_HANDLER_PATH environment variable
 * Loads handler synchronously at module load time for Lambda compatibility
 */

// Get handler path from environment
const handlerPath = process.env.LAMBDA_HANDLER_PATH || 'index.handler';
console.log(`[index.js] Handler path: ${handlerPath}`);

// Parse handler path: "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
// -> module: "http/any-api-streams-000workspaceId-000agentId-000secret/index"
// -> export: "handler"
const [modulePath, exportName = 'handler'] = handlerPath.split('.');

// Load handler module synchronously using require (for CommonJS) or import (for ES modules)
// Since dist files are ES modules, we need to use dynamic import, but we'll wrap it
let handlerModule;
let handler;

try {
  console.log(`[index.js] Loading handler from ${modulePath}.${exportName}...`);
  // Use dynamic import for ES modules
  handlerModule = require(`./${modulePath}.js`);
  handler = handlerModule[exportName] || handlerModule.default || handlerModule.handler;
  
  if (!handler || typeof handler !== 'function') {
    throw new Error(`Handler export "${exportName}" not found or is not a function in ${modulePath}`);
  }
  
  console.log(`[index.js] Successfully loaded handler from ${modulePath}.${exportName}`);
} catch (error) {
  console.error(`[index.js] Failed to load handler from ${modulePath}.${exportName}:`, error);
  console.error(`[index.js] Error stack:`, error.stack);
  // Create a fallback handler that will try to load on first invocation
  handler = async (event, context) => {
    try {
      const dynamicModule = await import(`./${modulePath}.js`);
      const dynamicHandler = dynamicModule[exportName] || dynamicModule.default || dynamicModule.handler;
      if (!dynamicHandler || typeof dynamicHandler !== 'function') {
        throw new Error(`Handler export "${exportName}" not found`);
      }
      return dynamicHandler(event, context);
    } catch (loadError) {
      console.error(`[index.js] Failed to load handler dynamically:`, loadError);
      throw loadError;
    }
  };
}

// Export handler (must be synchronous for Lambda to find it)
module.exports.handler = handler;
