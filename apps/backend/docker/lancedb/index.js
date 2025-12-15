/**
 * Simple entrypoint that loads the router
 * This ensures compatibility with Lambda's handler resolution
 */

console.log('[index.js] Loading router module...');

// Load the router module
let router;
try {
  router = require('./router.cjs');
  console.log('[index.js] Router module loaded successfully');
} catch (error) {
  console.error('[index.js] Failed to load router.cjs:', error);
  throw error;
}

// Export the handler
if (!router || !router.handler) {
  console.error('[index.js] Router does not have handler export');
  throw new Error('Router module does not export handler');
}

console.log('[index.js] Handler exported successfully');
module.exports.handler = router.handler;
