/**
 * Simple wrapper entrypoint for Lambda container images
 * Loads the handler from the path specified in LAMBDA_HANDLER_PATH environment variable
 * This allows a single Docker image to support multiple Lambda functions
 * 
 * IMPORTANT: Handler must be exported synchronously for Lambda to validate it at INIT time
 * No top-level code should execute during module load to avoid initialization failures
 */

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
  // Logging moved inside handler to avoid top-level execution during module load
  console.log('[index.js] ===== HANDLER INVOKED =====');
  console.log('[index.js] LAMBDA_TASK_ROOT:', process.env.LAMBDA_TASK_ROOT);
  console.log('[index.js] Current working directory:', process.cwd());
  console.log('[index.js] LAMBDA_HANDLER_PATH:', process.env.LAMBDA_HANDLER_PATH);
  
  // Check if this is RESPONSE_STREAM mode (responseStream has write/end methods but no functionName)
  const isResponseStream = contextOrStream && 
    typeof contextOrStream.write === 'function' && 
    typeof contextOrStream.end === 'function' &&
    !contextOrStream.functionName;
  
  try {
    const actualHandler = loadHandler();
    
    if (isResponseStream) {
      // For RESPONSE_STREAM mode, the handler is already wrapped with streamifyResponse
      console.log('[index.js] Calling handler in RESPONSE_STREAM mode');
      return await actualHandler(event, contextOrStream);
    } else {
      // Standard Lambda invocation with (event, context)
      console.log('[index.js] Calling handler in standard mode');
      return await actualHandler(event, contextOrStream);
    }
  } catch (error) {
    // Log error details safely without causing additional promise rejections
    try {
      console.error('[index.js] ===== HANDLER ERROR =====');
      console.error('[index.js] Error name:', error?.name || 'Unknown');
      console.error('[index.js] Error message:', error?.message || String(error));
      if (error?.stack) {
        // Truncate stack trace to prevent excessive logging
        const stackLines = error.stack.split('\n');
        const truncatedStack = stackLines.slice(0, 20).join('\n');
        console.error('[index.js] Error stack (truncated):', truncatedStack);
      }
    } catch (logError) {
      // If logging itself fails, just log a minimal message
      console.error('[index.js] Failed to log error details:', logError?.message || String(logError));
    }
    
    // Re-throw the original error
    // IMPORTANT: Don't wrap or modify the error to avoid creating new promise rejections
    // The actual handler's error handling (handlingErrors wrapper) will handle this properly
    throw error;
  }
};
