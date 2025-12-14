/**
 * Utility functions for HTTP to REST API transformation
 */

/**
 * Parse route key to extract HTTP method and path
 * @param {string} routeKey - Route key (e.g., "GET /api/usage", "ANY /api/auth/*")
 * @returns {{method: string, path: string}} Parsed method and path
 */
function parseRouteKey(routeKey) {
  const parts = routeKey.split(' ', 2);
  if (parts.length !== 2) {
    throw new Error(`Invalid route key format: ${routeKey}`);
  }
  return {
    method: parts[0].toUpperCase(),
    path: parts[1]
  };
}

/**
 * Convert HTTP API v2 path parameter format (:param) to REST API format ({param})
 * @param {string} path - Path with :param format
 * @returns {string} Path with {param} format
 */
function convertPathParameters(path) {
  return path.replace(/:([^/]+)/g, '{$1}');
}

/**
 * Check if a path contains a wildcard
 * Note: HTTP API v2 only supports wildcards at the end of paths (/*), not in the middle.
 * This function detects any wildcard, but only trailing wildcards are valid in HTTP API v2.
 * @param {string} path - Path to check
 * @returns {boolean} True if path contains wildcard
 */
function hasWildcard(path) {
  return path.includes('/*') || path.endsWith('*');
}

/**
 * Convert wildcard path to REST API proxy resource format
 * Note: HTTP API v2 only supports wildcards at the end of paths (/*), not in the middle.
 * This function handles trailing wildcards only.
 * @param {string} path - Path with wildcard (must have wildcard at the end)
 * @returns {string} Path with {proxy+} format
 */
function convertWildcardPath(path) {
  if (path === '/*' || path === '*') {
    return '{proxy+}';
  }
  // Replace trailing /* with /{proxy+}
  // Note: /\*$/ only matches wildcard at the end, which matches HTTP API v2's behavior
  return path.replace(/\*$/, '{proxy+}');
}

/**
 * Split path into segments
 * @param {string} path - Path to split
 * @returns {string[]} Array of path segments
 */
function splitPath(path) {
  // Remove leading slash and split
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  if (cleanPath === '' || cleanPath === '*') {
    return [];
  }
  return cleanPath.split('/').filter(segment => segment.length > 0);
}

/**
 * Generate resource logical ID from path segment
 * @param {string} segment - Path segment
 * @param {number} index - Index in path
 * @returns {string} Resource logical ID
 */
function generateResourceId(segment, index = 0) {
  // Convert path parameter format {param} to Param
  const normalized = segment
    .replace(/^{(.+)}$/, '$1')
    .replace(/^{(.+)\+}$/, '$1Proxy')
    .replace(/[^a-zA-Z0-9]/g, ' ');
  
  // Convert to PascalCase, preserving original casing within words
  // Split on spaces/underscores and capitalize first letter of each word
  const pascalCased = normalized
    .split(/[\s_]+/) // split on spaces or underscores
    .filter(Boolean) // remove empty strings
    .map(word => word.charAt(0).toUpperCase() + word.slice(1)) // capitalize first letter, preserve rest
    .join('');
  
  return pascalCased || `Segment${index}`;
}

/**
 * Generate method logical ID
 * @param {string} resourceId - Resource logical ID
 * @param {string} method - HTTP method
 * @returns {string} Method logical ID
 */
function generateMethodId(resourceId, method) {
  return `${resourceId}${method}Method`;
}

/**
 * Get all HTTP methods for ANY method
 * @returns {string[]} Array of HTTP methods
 */
function getAllHttpMethods() {
  return ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
}

/**
 * Sanitize resource name for CloudFormation
 * @param {string} name - Name to sanitize
 * @returns {string} Sanitized name
 */
function sanitizeResourceName(name) {
  // CloudFormation logical IDs must be alphanumeric
  return name.replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Check if an authorizer is an IAM authorizer
 * @param {Object} authorizer - Authorizer resource
 * @returns {boolean} True if authorizer is IAM type
 */
function isIamAuthorizer(authorizer) {
  if (!authorizer || !authorizer.Properties) {
    return false;
  }
  const authorizerType = authorizer.Properties.AuthorizerType;
  return authorizerType === 'IAM' || authorizerType === 'AWS_IAM';
}

module.exports = {
  parseRouteKey,
  convertPathParameters,
  hasWildcard,
  convertWildcardPath,
  splitPath,
  generateResourceId,
  generateMethodId,
  getAllHttpMethods,
  sanitizeResourceName,
  isIamAuthorizer,
};

