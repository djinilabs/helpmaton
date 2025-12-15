/**
 * Simple wrapper entrypoint for Lambda container images
 * Loads the handler from the path specified in LAMBDA_HANDLER_PATH environment variable
 * This allows a single Docker image to support multiple Lambda functions
 */

const handlerPath = process.env.LAMBDA_HANDLER_PATH || 'index.handler';
const [modulePath, exportName = 'handler'] = handlerPath.split('.');

// Dynamically require the handler module
const handlerModule = require(`./${modulePath}.js`);
const handler = handlerModule[exportName] || handlerModule.default || handlerModule.handler;

if (!handler || typeof handler !== 'function') {
  throw new Error(`Handler export "${exportName}" not found or is not a function in ${modulePath}`);
}

// Export the handler
exports.handler = handler;
