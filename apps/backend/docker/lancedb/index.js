/**
 * Simple wrapper entrypoint for Lambda container images
 * Loads the handler from the path specified in LAMBDA_HANDLER_PATH environment variable
 * This allows a single Docker image to support multiple Lambda functions
 */

console.log('[index.js] Module loading...');
console.log('[index.js] LAMBDA_HANDLER_PATH:', process.env.LAMBDA_HANDLER_PATH);

// Cache the loaded handler
let cachedHandler = null;

// Lazy load the handler on first invocation
function loadHandler() {
  if (cachedHandler) {
    return cachedHandler;
  }

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
    cachedHandler = handler;
    return handler;
  } catch (error) {
    console.error('[index.js] Failed to load handler:', error);
    console.error('[index.js] Error message:', error.message);
    console.error('[index.js] Error stack:', error.stack);
    throw error;
  }
}

// Export handler that loads the actual handler on first invocation
exports.handler = async (event, context) => {
  console.log('[index.js] Handler invoked');
  const actualHandler = loadHandler();
  console.log('[index.js] Calling actual handler...');
  return actualHandler(event, context);
};

console.log('[index.js] Module loaded, handler exported');
