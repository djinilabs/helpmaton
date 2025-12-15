/**
 * Simple wrapper entrypoint for Lambda container images
 * Loads the handler from the path specified in LAMBDA_HANDLER_PATH environment variable
 * This allows a single Docker image to support multiple Lambda functions
 */

console.log('[index.js] Module loading...');
console.log('[index.js] LAMBDA_HANDLER_PATH:', process.env.LAMBDA_HANDLER_PATH);

const handlerPath = process.env.LAMBDA_HANDLER_PATH || 'index.handler';
const [modulePath, exportName = 'handler'] = handlerPath.split('.');

console.log(`[index.js] Loading handler from ./${modulePath}.js, export: ${exportName}`);

try {
  // Dynamically require the handler module
  const handlerModule = require(`./${modulePath}.js`);
  const handler = handlerModule[exportName] || handlerModule.default || handlerModule.handler;

  if (!handler || typeof handler !== 'function') {
    throw new Error(`Handler export "${exportName}" not found or is not a function in ${modulePath}`);
  }

  console.log(`[index.js] Successfully loaded handler from ${modulePath}.${exportName}`);

  // Export the handler
  exports.handler = handler;
  console.log('[index.js] Handler exported');
} catch (error) {
  console.error('[index.js] Failed to load handler:', error);
  console.error('[index.js] Error stack:', error.stack);
  throw error;
}
