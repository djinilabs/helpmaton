import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
  Context,
  Callback,
  LambdaFunctionURLEvent,
} from "aws-lambda";

/**
 * Type guard to check if an event is a REST API Gateway event
 */
function isRestEvent(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaFunctionURLEvent | LambdaUrlEvent
): event is APIGatewayProxyEvent {
  return "httpMethod" in event && event.httpMethod !== undefined;
}

/**
 * Type guard to check if an event is a Lambda Function URL event
 */
function isLambdaUrlEvent(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaFunctionURLEvent | LambdaUrlEvent
): event is LambdaFunctionURLEvent | LambdaUrlEvent {
  // Lambda Function URL events have a specific structure
  // They have requestContext.http.method (not httpMethod at top level)
  // and have rawPath (not path like REST API)
  if (typeof event !== "object" || event === null) {
    return false;
  }

  const eventAny = event as unknown as Record<string, unknown>;

  // REST API events have httpMethod at top level - exclude those
  if ("httpMethod" in eventAny) {
    return false;
  }

  // Check for Lambda Function URL event structure
  // Function URL events have rawPath AND requestContext.http.method
  // HTTP API v2 events also have these, but we can distinguish by checking:
  // - HTTP API v2 events have version "2.0" AND routeKey AND the structure matches APIGatewayProxyEventV2
  // - Function URL events have rawPath, requestContext.http.method, but the requestContext structure is different
  // The key difference: Function URL events have requestContext with http.method directly accessible
  // AND the requestContext doesn't have the same structure as HTTP API v2
  // Actually, both have similar structures, so we need a different approach
  // The distinguishing feature: if it has rawPath and requestContext.http.method and no httpMethod,
  // AND it's not already an HTTP API v2 event (which we check by type narrowing)
  // Since we can't check TypeScript types at runtime, we check the structure:
  // HTTP API v2 events that are already in the correct format will have version "2.0" and be passed through
  // Function URL events need transformation
  // The safest check: if it has the Function URL structure (rawPath, requestContext.http.method)
  // AND it's not REST (already checked), treat it as Function URL if it needs transformation
  // But we need to exclude HTTP API v2 events which are already in the correct format
  // HTTP API v2 events have version "2.0" and are already APIGatewayProxyEventV2 format
  // Function URL events need to be transformed FROM their format TO HTTP v2 format
  // So if it has rawPath and requestContext.http.method and it's NOT already HTTP v2 format,
  // it's a Function URL event
  // But how do we check if it's "already HTTP v2 format"? 
  // We can check: if it has version "2.0" AND routeKey AND the structure matches HTTP v2,
  // it's already HTTP v2 and doesn't need transformation
  // Function URL events might have version "2.0" but need transformation anyway
  // Actually, the real check: Function URL events have a LambdaUrlEvent structure
  // which includes rawPath, routeKey, requestContext with http.method
  // HTTP API v2 events have APIGatewayProxyEventV2 structure
  // The difference: Function URL events need transformation, HTTP v2 events don't
  // So we check: if it matches LambdaUrlEvent structure (has rawPath, requestContext.http.method)
  // AND it's not REST, it's a Function URL event that needs transformation
  // But we must exclude HTTP v2 events which also match this pattern
  // The solution: check if the event structure is EXACTLY like HTTP v2 (has all HTTP v2 fields)
  // If it does, it's HTTP v2. If it doesn't but has Function URL structure, it's Function URL
  if (
    "rawPath" in eventAny &&
    eventAny.requestContext &&
    typeof eventAny.requestContext === "object" &&
    eventAny.requestContext !== null
  ) {
    const requestContext = eventAny.requestContext as Record<string, unknown>;
    if (
      requestContext.http &&
      typeof requestContext.http === "object" &&
      requestContext.http !== null &&
      "method" in requestContext.http
    ) {
      // Check if this is already an HTTP API v2 event by checking for HTTP v2 specific structure
      // HTTP API v2 events have version "2.0" and routeKey and are already in the correct format
      // If it's already HTTP v2 format, don't treat it as Function URL
      // The key: HTTP v2 events that are passed to adaptHttpHandler are already APIGatewayProxyEventV2
      // Function URL events are LambdaFunctionURLEvent or LambdaUrlEvent and need transformation
      // Since we can't check types at runtime, we check: if it has version "2.0" and routeKey
      // and the structure looks like HTTP v2 (has all the HTTP v2 fields), it's HTTP v2
      // Otherwise, if it has rawPath and requestContext.http.method, it's Function URL
      // But this is tricky because Function URL events might also have version "2.0"
      // The real solution: Function URL events from AWS have a specific requestContext structure
      // that's different from HTTP API v2. But they're very similar.
      // Actually, let's use a simpler approach: if the event type is LambdaFunctionURLEvent or LambdaUrlEvent
      // (which we can't check at runtime), we rely on the structure
      // The distinguishing feature: Function URL events need transformation, so if it has the structure
      // and it's not REST and it's not already HTTP v2 (which we assume if it has version "2.0" and looks like HTTP v2),
      // treat it as Function URL
      // For now, let's be conservative: only treat it as Function URL if it clearly matches the structure
      // and doesn't look like HTTP v2
      // Check: if it has rawPath and requestContext.http.method and no httpMethod, it's likely Function URL
      // UNLESS it's clearly HTTP v2 (has version "2.0" and all HTTP v2 fields)
      const hasHttpV2Structure = 
        eventAny.version === "2.0" &&
        "routeKey" in eventAny &&
        typeof eventAny.routeKey === "string" &&
        "requestContext" in eventAny &&
        typeof eventAny.requestContext === "object" &&
        eventAny.requestContext !== null &&
        "routeKey" in (eventAny.requestContext as Record<string, unknown>);
      
      // If it has HTTP v2 structure, it's HTTP v2, not Function URL
      if (hasHttpV2Structure) {
        return false;
      }
      
      // Otherwise, if it has Function URL structure, it's Function URL
      return true;
    }
  }

  return false;
}

/**
 * Converts multi-value headers to single-value headers.
 * Takes the first value from each array.
 */
function convertMultiValueHeaders(
  multiValueHeaders?: APIGatewayProxyEvent["multiValueHeaders"]
): Record<string, string> {
  if (!multiValueHeaders) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const [key, values] of Object.entries(multiValueHeaders)) {
    if (values && Array.isArray(values) && values.length > 0) {
      headers[key] = values[0];
    }
  }
  return headers;
}

/**
 * Converts multi-value query string parameters to single-value parameters.
 * Takes the first value from each array.
 */
function convertMultiValueQueryStringParameters(
  multiValueParams?: APIGatewayProxyEvent["multiValueQueryStringParameters"]
): Record<string, string> | undefined {
  if (!multiValueParams) {
    return undefined;
  }

  const params: Record<string, string> = {};
  for (const [key, values] of Object.entries(multiValueParams)) {
    if (values && Array.isArray(values) && values.length > 0) {
      params[key] = values[0];
    }
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Builds rawQueryString from query string parameters
 */
function buildRawQueryString(
  queryStringParameters?: Record<string, string> | null
): string {
  if (!queryStringParameters) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(queryStringParameters)) {
    params.append(key, value);
  }
  return params.toString();
}

/**
 * Transforms a REST API Gateway event into an HTTP v2 event format.
 */
function transformRestToHttpV2Event(
  event: APIGatewayProxyEvent
): APIGatewayProxyEventV2 {
  const restContext = event.requestContext;

  // Convert headers - prefer multiValueHeaders if available, fallback to headers
  // HTTP API v2 headers are case-insensitive and typically lowercase
  let headers =
    event.multiValueHeaders && Object.keys(event.multiValueHeaders).length > 0
      ? convertMultiValueHeaders(event.multiValueHeaders)
      : event.headers || {};

  // Normalize headers to lowercase (HTTP API v2 convention)
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      normalizedHeaders[key.toLowerCase()] = value;
    }
  }
  headers = normalizedHeaders;

  // Extract cookies from Cookie header (REST API sends cookies in Cookie header, not as separate cookies array)
  // HTTP API v2 has a cookies array, so we need to extract them from the Cookie header
  // IMPORTANT: Remove the Cookie header from headers after extraction, as HTTP API v2 doesn't include it
  let cookies: string[] | undefined;
  const cookieHeader = headers.cookie;
  if (cookieHeader) {
    cookies = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    // Remove Cookie header from headers (HTTP API v2 uses cookies array instead)
    delete headers.cookie;
  }

  // Convert query string parameters - prefer multiValueQueryStringParameters if available
  let queryStringParameters: Record<string, string> | undefined;
  if (
    event.multiValueQueryStringParameters &&
    Object.keys(event.multiValueQueryStringParameters).length > 0
  ) {
    queryStringParameters = convertMultiValueQueryStringParameters(
      event.multiValueQueryStringParameters
    );
  } else if (event.queryStringParameters) {
    // Convert from APIGatewayProxyEventQueryStringParameters to Record<string, string>
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(event.queryStringParameters)) {
      if (value !== undefined) {
        params[key] = value;
      }
    }
    queryStringParameters = Object.keys(params).length > 0 ? params : undefined;
  } else {
    queryStringParameters = undefined;
  }

  // Build rawQueryString from query parameters
  const rawQueryString = buildRawQueryString(queryStringParameters);

  // Build requestContext.http object
  const httpContext = {
    method: event.httpMethod,
    path: restContext.path || event.path,
    protocol: restContext.protocol || "HTTP/1.1",
    sourceIp: restContext.identity?.sourceIp || "",
    userAgent: restContext.identity?.userAgent || "",
  };

  // Build routeKey in HTTP API v2 format: "METHOD /path"
  // For REST API, event.resource is the resource path (e.g., "/api/auth/{proxy+}")
  // HTTP API v2 routeKey format is "METHOD /path" (e.g., "GET /api/auth/{proxy+}")
  const resourcePath = event.resource || "$default";
  const routeKey = `${event.httpMethod} ${resourcePath}`;

  // Build the HTTP v2 requestContext
  const requestContext: APIGatewayProxyEventV2["requestContext"] = {
    accountId: restContext.accountId,
    apiId: restContext.apiId,
    domainName: restContext.domainName || "",
    domainPrefix: restContext.domainPrefix || "",
    http: httpContext,
    requestId: restContext.requestId,
    routeKey: routeKey,
    stage: restContext.stage || "$default",
    time: restContext.requestTime || new Date().toISOString(),
    timeEpoch: restContext.requestTimeEpoch || Date.now(),
  };

  // Build the HTTP v2 event
  const httpV2Event: APIGatewayProxyEventV2 = {
    version: "2.0",
    routeKey: routeKey,
    rawPath: event.path,
    rawQueryString,
    headers,
    requestContext,
    body: event.body ?? undefined,
    isBase64Encoded: event.isBase64Encoded || false,
    queryStringParameters,
    pathParameters: event.pathParameters || undefined,
    stageVariables: event.stageVariables || undefined,
    cookies: cookies && cookies.length > 0 ? cookies : undefined,
  };

  return httpV2Event;
}

/**
 * Lambda Function URL event format
 */
export interface LambdaUrlEvent {
  version: string;
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string>;
  requestContext: {
    http: {
      method: string;
      path: string;
      protocol: string;
      sourceIp: string;
      userAgent: string;
    };
    requestId: string;
    accountId: string;
    apiId: string;
    domainName: string;
    domainPrefix: string;
    stage: string;
    time: string;
    timeEpoch: number;
  };
  body: string;
  isBase64Encoded: boolean;
}

/**
 * Extracts path parameters from rawPath for different route patterns
 */
function extractPathParametersFromPath(
  rawPath: string
): Record<string, string> | undefined {
  // Pattern 1: /api/streams/:workspaceId/:agentId/:secret
  // Note: secret can contain slashes, so we match everything after agentId
  const streamsMatch = rawPath.match(
    /^\/api\/streams\/([^/]+)\/([^/]+)\/(.+)$/
  );
  if (streamsMatch) {
    return {
      workspaceId: streamsMatch[1],
      agentId: streamsMatch[2],
      secret: streamsMatch[3],
    };
  }

  // Pattern 2: /api/workspaces/:workspaceId/agents/:agentId/test
  const testAgentMatch = rawPath.match(
    /^\/api\/workspaces\/([^/]+)\/agents\/([^/]+)\/test$/
  );
  if (testAgentMatch) {
    return {
      workspaceId: testAgentMatch[1],
      agentId: testAgentMatch[2],
    };
  }

  // Add more patterns as needed
  return undefined;
}

/**
 * Transforms a Lambda Function URL event into an HTTP v2 event format.
 * This allows handlers to reuse existing HTTP v2 event handling logic.
 */
export function transformLambdaUrlToHttpV2Event(
  event: LambdaFunctionURLEvent | LambdaUrlEvent
): APIGatewayProxyEventV2 {
  // Normalize headers to lowercase (HTTP API v2 convention)
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (value !== undefined) {
      normalizedHeaders[key.toLowerCase()] = value;
    }
  }

  // Extract cookies from Cookie header if present
  let cookies: string[] | undefined;
  const cookieHeader = normalizedHeaders.cookie;
  if (cookieHeader) {
    cookies = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    // Remove Cookie header from headers (HTTP API v2 uses cookies array instead)
    delete normalizedHeaders.cookie;
  }

  // Parse query string parameters
  let queryStringParameters: Record<string, string> | undefined;
  if (event.rawQueryString) {
    const params = new URLSearchParams(event.rawQueryString);
    if (params.toString()) {
      queryStringParameters = {};
      for (const [key, value] of params.entries()) {
        queryStringParameters[key] = value;
      }
    }
  }

  // Extract path parameters from rawPath for multiple route patterns
  const pathParameters = extractPathParametersFromPath(event.rawPath);

  // Build requestContext
  const routeKey =
    "routeKey" in event && event.routeKey
      ? event.routeKey
      : `${event.requestContext.http.method} ${event.rawPath}`;

  const requestContext: APIGatewayProxyEventV2["requestContext"] = {
    accountId: event.requestContext.accountId || "",
    apiId: event.requestContext.apiId || "",
    domainName: event.requestContext.domainName || "",
    domainPrefix: event.requestContext.domainPrefix || "",
    http: {
      method: event.requestContext.http.method,
      path: event.requestContext.http.path,
      protocol: event.requestContext.http.protocol,
      sourceIp: event.requestContext.http.sourceIp,
      userAgent: event.requestContext.http.userAgent,
    },
    requestId: event.requestContext.requestId || "",
    routeKey: routeKey,
    stage: event.requestContext.stage || "$default",
    time: event.requestContext.time || new Date().toISOString(),
    timeEpoch: event.requestContext.timeEpoch || Date.now(),
  };

  // Build the HTTP v2 event
  const httpV2Event: APIGatewayProxyEventV2 = {
    version: "2.0",
    routeKey: routeKey,
    rawPath: event.rawPath,
    rawQueryString: event.rawQueryString,
    headers: normalizedHeaders,
    requestContext,
    body: event.body || undefined,
    isBase64Encoded: event.isBase64Encoded || false,
    queryStringParameters,
    pathParameters,
    cookies: cookies && cookies.length > 0 ? cookies : undefined,
  };

  return httpV2Event;
}

/**
 * Wraps an HTTP v2 event handler to handle HTTP v2, REST API Gateway, and Lambda Function URL events.
 *
 * @param handler - The original HTTP v2 event handler
 * @returns A new handler that can process REST, HTTP v2, and Function URL event types
 *
 * @example
 * ```typescript
 * const myHandler: APIGatewayProxyHandlerV2 = async (event) => {
 *   return { statusCode: 200, body: "OK" };
 * };
 *
 * export const handler = adaptHttpHandler(myHandler);
 * ```
 */
export function adaptHttpHandler(
  handler: APIGatewayProxyHandlerV2
): (
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaFunctionURLEvent | LambdaUrlEvent,
  context: Context,
  callback: Callback
) => Promise<APIGatewayProxyResultV2> {
  return async (
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2 | LambdaFunctionURLEvent | LambdaUrlEvent,
    context: Context,
    callback: Callback
  ): Promise<APIGatewayProxyResultV2> => {
    try {
      const isRest = isRestEvent(event);
      // Check for Function URL events before assuming HTTP v2
      // Function URL events might have version "2.0" but have a different structure
      const isLambdaUrl = isLambdaUrlEvent(event);

      // Convert events to HTTP v2 format if needed
      let httpV2Event: APIGatewayProxyEventV2;
      if (isRest) {
        httpV2Event = transformRestToHttpV2Event(event);
      } else if (isLambdaUrl) {
        httpV2Event = transformLambdaUrlToHttpV2Event(event);
      } else {
        // Already HTTP v2 format (or unknown format - assume HTTP v2)
        httpV2Event = event;
      }
      const result = await handler(httpV2Event, context, callback);
      if (!result) {
        throw new Error("Handler returned undefined");
      }

      // For REST API events, ensure response format is compatible
      // REST API Gateway expects a specific response format and doesn't support some HTTP API v2 fields
      if (
        isRest &&
        typeof result === "object" &&
        result !== null &&
        !Array.isArray(result)
      ) {
        const resultObj = result as Record<string, unknown>;

        // Decode base64-encoded responses (HTTP API v2 automatically decodes, but REST API doesn't)
        if (
          "isBase64Encoded" in resultObj &&
          resultObj.isBase64Encoded === true &&
          "body" in resultObj &&
          typeof resultObj.body === "string"
        ) {
          try {
            const decodedBody = Buffer.from(resultObj.body, "base64").toString(
              "utf-8"
            );
            resultObj.body = decodedBody;
            resultObj.isBase64Encoded = false;
          } catch (error) {
            // If decoding fails, log and keep original response
            console.error(
              "[httpEventAdapter] Failed to decode base64 response:",
              error
            );
          }
        }

        // Ensure response format is compatible with REST API Gateway
        // REST API doesn't support multiValueHeaders or cookies array in responses
        // Transform these fields into REST-compatible format
        const restApiResponse: APIGatewayProxyResultV2 = {
          statusCode: resultObj.statusCode as number,
        };

        // Handle headers: convert multiValueHeaders to headers if present
        // If both headers and multiValueHeaders exist, prefer multiValueHeaders (convert to headers)
        if ("multiValueHeaders" in resultObj && resultObj.multiValueHeaders) {
          // Convert multiValueHeaders to headers (take first value from each array)
          const multiValueHeaders = resultObj.multiValueHeaders as Record<
            string,
            string[]
          >;
          const convertedHeaders: Record<string, string> = {};
          for (const [key, values] of Object.entries(multiValueHeaders)) {
            if (values && Array.isArray(values) && values.length > 0) {
              convertedHeaders[key] = values[0];
            }
          }
          restApiResponse.headers = convertedHeaders;
        } else if ("headers" in resultObj && resultObj.headers) {
          restApiResponse.headers = resultObj.headers as Record<string, string>;
        }

        // Handle cookies: convert cookies array to Set-Cookie headers
        // REST API doesn't support cookies array in responses, but supports Set-Cookie headers
        // LIMITATION: REST API responses don't support multiValueHeaders, so we can only set one Set-Cookie header
        // If multiple cookies are present, we'll use the first one (this is a known limitation)
        if ("cookies" in resultObj && resultObj.cookies) {
          const cookies = resultObj.cookies as string[];
          if (!restApiResponse.headers) {
            restApiResponse.headers = {};
          }
          if (cookies.length > 0) {
            // REST API responses don't support multiple Set-Cookie headers (no multiValueHeaders)
            // So we can only send the first cookie
            // This is a limitation when converting from HTTP API v2 to REST API
            restApiResponse.headers["Set-Cookie"] = cookies[0];
            if (cookies.length > 1) {
              console.warn(
                `[httpEventAdapter] Multiple cookies in response (${cookies.length}), but REST API only supports one Set-Cookie header. Using first cookie only.`
              );
            }
          }
        }

        // Include body if present
        if ("body" in resultObj && resultObj.body !== undefined) {
          restApiResponse.body = resultObj.body as string;
        }

        // Include isBase64Encoded if present (after potential decoding above)
        if ("isBase64Encoded" in resultObj) {
          restApiResponse.isBase64Encoded = resultObj.isBase64Encoded === true;
        }

        return restApiResponse;
      }

      return result;
    } finally {
      // Flush Sentry and PostHog events before Lambda terminates (critical for Lambda)
      // This ensures flushing happens on both success and error paths
      // Import dynamically to avoid circular dependencies
      const [{ flushPostHog }, { flushSentry }] = await Promise.all([
        import("../utils/posthog"),
        import("../utils/sentry"),
      ]);
      await Promise.all([flushPostHog(), flushSentry()]).catch(
        (flushErrors) => {
          console.error("[PostHog/Sentry] Error flushing events:", flushErrors);
        }
      );
    }
  };
}
