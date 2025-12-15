/**
 * Simple wrapper entrypoint for Lambda container images
 * Loads the handler from the path specified in LAMBDA_HANDLER_PATH environment variable
 * This allows a single Docker image to support multiple Lambda functions
 */

// Log immediately when module loads (this should appear in logs if module loads)
console.log('[index.js] ===== MODULE LOADING START =====');
console.log('[index.js] Process PID:', process.pid);
console.log('[index.js] Node version:', process.version);
console.log('[index.js] CWD:', process.cwd());
console.log('[index.js] LAMBDA_TASK_ROOT:', process.env.LAMBDA_TASK_ROOT);
console.log('[index.js] LAMBDA_HANDLER_PATH:', process.env.LAMBDA_HANDLER_PATH);
console.log('[index.js] AWS_LAMBDA_FUNCTION_NAME:', process.env.AWS_LAMBDA_FUNCTION_NAME);

// Cache the loaded handler
let cachedHandler = null;

// Lazy load the handler on first invocation
function loadHandler() {
  console.log('[index.js] loadHandler() called');
  if (cachedHandler) {
    console.log('[index.js] Using cached handler');
    return cachedHandler;
  }

  const handlerPath = process.env.LAMBDA_HANDLER_PATH || 'index.handler';
  const [modulePath, exportName = 'handler'] = handlerPath.split('.');

  console.log(`[index.js] Loading handler from ./${modulePath}.js, export: ${exportName}`);
  console.log(`[index.js] Full handler path: ${handlerPath}`);

  try {
    // Check if file exists first
    const fs = require('fs');
    const path = require('path');
    const fullPath = path.join(process.env.LAMBDA_TASK_ROOT || process.cwd(), `${modulePath}.js`);
    console.log(`[index.js] Checking if file exists: ${fullPath}`);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Handler file does not exist: ${fullPath}`);
    }
    console.log(`[index.js] File exists, size: ${fs.statSync(fullPath).size} bytes`);

    // Dynamically require the handler module
    console.log(`[index.js] Attempting to require: ./${modulePath}.js`);
    const handlerModule = require(`./${modulePath}.js`);
    console.log(`[index.js] Module loaded, exports:`, Object.keys(handlerModule));
    
    const handler = handlerModule[exportName] || handlerModule.default || handlerModule.handler;
    console.log(`[index.js] Handler found:`, typeof handler, handler ? 'is function' : 'is not function');

    if (!handler || typeof handler !== 'function') {
      throw new Error(`Handler export "${exportName}" not found or is not a function in ${modulePath}. Available exports: ${Object.keys(handlerModule).join(', ')}`);
    }

    console.log(`[index.js] Successfully loaded handler from ${modulePath}.${exportName}`);
    cachedHandler = handler;
    return handler;
  } catch (error) {
    console.error('[index.js] ===== FAILED TO LOAD HANDLER =====');
    console.error('[index.js] Error name:', error.name);
    console.error('[index.js] Error message:', error.message);
    console.error('[index.js] Error code:', error.code);
    console.error('[index.js] Error stack:', error.stack);
    throw error;
  }
}

// Export handler that loads the actual handler on first invocation
// For RESPONSE_STREAM mode, Lambda passes (event, responseStream) instead of (event, context)
// We need to detect this and handle it appropriately
exports.handler = async (event, contextOrStream) => {
  console.log('[index.js] ===== HANDLER INVOKED =====');
  console.log('[index.js] Event type:', typeof event);
  console.log('[index.js] Second param type:', typeof contextOrStream);
  console.log('[index.js] Second param has write method:', typeof contextOrStream?.write === 'function');
  console.log('[index.js] Second param has functionName:', !!contextOrStream?.functionName);
  
  // Check if this is RESPONSE_STREAM mode (responseStream has write/end methods but no functionName)
  const isResponseStream = contextOrStream && 
    typeof contextOrStream.write === 'function' && 
    typeof contextOrStream.end === 'function' &&
    !contextOrStream.functionName; // context has functionName, responseStream doesn't
  
  if (isResponseStream) {
    console.log('[index.js] Detected RESPONSE_STREAM mode');
    // For RESPONSE_STREAM mode, Lambda runtime calls the handler with (event, responseStream)
    // The actual handler is already wrapped with awslambda.streamifyResponse in the source code
    // We need to load it and call it directly - the streamifyResponse wrapper expects (event, responseStream)
    try {
      const actualHandler = loadHandler();
      console.log('[index.js] Calling actual handler with RESPONSE_STREAM signature (event, responseStream)...');
      // The handler exported from the module is already wrapped with streamifyResponse
      // It expects (event, responseStream) signature
      return await actualHandler(event, contextOrStream);
    } catch (error) {
      console.error('[index.js] ===== HANDLER ERROR (RESPONSE_STREAM) =====');
      console.error('[index.js] Error name:', error.name);
      console.error('[index.js] Error message:', error.message);
      console.error('[index.js] Error stack:', error.stack);
      throw error;
    }
  } else {
    // Standard Lambda invocation with (event, context)
    console.log('[index.js] Standard Lambda invocation mode');
    try {
      const actualHandler = loadHandler();
      console.log('[index.js] Calling actual handler with standard signature (event, context)...');
      const result = await actualHandler(event, contextOrStream);
      console.log('[index.js] Handler completed successfully');
      return result;
    } catch (error) {
      console.error('[index.js] ===== HANDLER ERROR =====');
      console.error('[index.js] Error name:', error.name);
      console.error('[index.js] Error message:', error.message);
      console.error('[index.js] Error stack:', error.stack);
      throw error;
    }
  }
};

console.log('[index.js] ===== MODULE LOADED, HANDLER EXPORTED =====');
console.log('[index.js] Handler type:', typeof exports.handler);
console.log('[index.js] Handler is function:', typeof exports.handler === 'function');

