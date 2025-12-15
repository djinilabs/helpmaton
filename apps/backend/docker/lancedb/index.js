/**
 * Simple wrapper entrypoint for Lambda container images
 * Loads the handler from the path specified in LAMBDA_HANDLER_PATH environment variable
 * This allows a single Docker image to support multiple Lambda functions
 * 
 * IMPORTANT: Handler must be exported synchronously for Lambda to validate it at INIT time
 */

// Top-level logging to verify module is loaded at INIT time
console.log('[index.js] ===== MODULE LOADED AT INIT TIME =====');
console.log('[index.js] LAMBDA_TASK_ROOT:', process.env.LAMBDA_TASK_ROOT);
console.log('[index.js] Current working directory:', process.cwd());
console.log('[index.js] __dirname equivalent check');
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

  try {
    // Dynamically require the handler module
    const handlerModule = require(`./${modulePath}.js`);
    const handler = handlerModule[exportName] || handlerModule.default || handlerModule.handler;

    if (!handler || typeof handler !== 'function') {
      throw new Error(`Handler export "${exportName}" not found or is not a function in ${modulePath}`);
    }

    cachedHandler = handler;
    return handler;
  } catch (error) {
    console.error('[index.js] Failed to load handler:', error);
    throw error;
  }
}

// Export handler synchronously - Lambda validates this at INIT time
// For RESPONSE_STREAM mode, Lambda passes (event, responseStream) instead of (event, context)
exports.handler = async (event, contextOrStream) => {
  // Check if this is RESPONSE_STREAM mode (responseStream has write/end methods but no functionName)
  const isResponseStream = contextOrStream && 
    typeof contextOrStream.write === 'function' && 
    typeof contextOrStream.end === 'function' &&
    !contextOrStream.functionName;
  
  const actualHandler = loadHandler();
  
  if (isResponseStream) {
    // For RESPONSE_STREAM mode, the handler is already wrapped with streamifyResponse
    return await actualHandler(event, contextOrStream);
  } else {
    // Standard Lambda invocation with (event, context)
    return await actualHandler(event, contextOrStream);
  }
};
