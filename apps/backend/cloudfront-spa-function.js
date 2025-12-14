/**
 * CloudFront Function for SPA Routing
 * 
 * This function intercepts viewer requests and rewrites HTML document requests
 * to /index.html, allowing the SPA router to handle client-side routing.
 * 
 * Only applies to HTML document requests (based on Accept header or lack of file extension).
 * Static assets (JS, CSS, images, etc.) are passed through unchanged.
 * 
 * Usage:
 * 1. Create a CloudFront function in AWS Console
 * 2. Paste this code into the function editor
 * 3. Publish the function
 * 4. Associate it with your CloudFront distribution's "Viewer Request" event
 * 5. Remove existing error page configurations (404/403 -> /index.html)
 */

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var headers = request.headers;

  // List of common static file extensions that should NOT be rewritten
  var staticFileExtensions = [
    '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.json', '.xml', '.txt', '.pdf',
    '.mp4', '.webm', '.mp3', '.wav',
    '.zip', '.tar', '.gz'
  ];

  // Check if URI has a file extension
  var hasFileExtension = staticFileExtensions.some(function(ext) {
    return uri.toLowerCase().endsWith(ext);
  });

  // Check if request Accept header includes text/html
  var acceptsHtml = false;
  if (headers.accept && headers.accept.value) {
    acceptsHtml = headers.accept.value.includes('text/html');
  }

  // Rewrite to /index.html if:
  // 1. Request accepts HTML (Accept: text/html), OR
  // 2. URI has no file extension (likely a route)
  if (acceptsHtml || !hasFileExtension) {
    // Rewrite URI to /index.html
    // Note: Query string is automatically preserved by CloudFront
    request.uri = '/index.html';
  }

  return request;
}

