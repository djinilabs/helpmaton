/**
 * Simple entrypoint that loads the router
 * This ensures compatibility with Lambda's handler resolution
 */

// Load the router module
const router = require('./router.cjs');

// Export the handler
module.exports.handler = router.handler;
