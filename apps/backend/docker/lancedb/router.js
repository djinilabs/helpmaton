/**
 * Router entrypoint for Lambda container images
 * Routes to the correct handler based on LAMBDA_HANDLER_PATH environment variable
 * This allows a single Docker image to support multiple Lambda functions
 * 
 * Uses ES modules (import/export) since the dist files are ES modules
 */

// Lambda sets AWS_LAMBDA_FUNCTION_NAME automatically
const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME || '';
const handlerPath = process.env.LAMBDA_HANDLER_PATH || 'index.handler';

console.log(`[router] Function: ${functionName}, Handler path: ${handlerPath}`);

// Parse handler path: "http/any-api-streams-000workspaceId-000agentId-000secret/index.handler"
// -> module: "http/any-api-streams-000workspaceId-000agentId-000secret/index"
// -> export: "handler"
const [modulePath, exportName = 'handler'] = handlerPath.split('.');

// Load handler module using dynamic import (ES modules)
// Lambda runtime supports top-level await for ES modules
let handlerModule;
let handler;

try {
  // Import the handler module
  handlerModule = await import(`./${modulePath}.js`);
  handler = handlerModule[exportName] || handlerModule.default || handlerModule.handler;
  
  if (!handler || typeof handler !== 'function') {
    throw new Error(`Handler export "${exportName}" not found or is not a function in ${modulePath}`);
  }
  
  console.log(`[router] Successfully loaded handler from ${modulePath}.${exportName}`);
} catch (error) {
  console.error(`[router] Failed to load handler from ${modulePath}.${exportName}:`, error);
  throw error;
}

// Export the handler for Lambda to invoke (ES modules)
export { handler };
