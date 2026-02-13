import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  Context,
  Callback,
} from "aws-lambda";
import type { Request, Response, NextFunction } from "express";
import { vi } from "vitest";

/**
 * Helper to create a minimal valid identity object for REST API events
 */
function createIdentity(
  overrides?: Partial<APIGatewayProxyEvent["requestContext"]["identity"]>,
) {
  return {
    accessKey: null,
    accountId: null,
    apiKey: null,
    apiKeyId: null,
    caller: null,
    cognitoAuthenticationProvider: null,
    cognitoAuthenticationType: null,
    cognitoIdentityId: null,
    cognitoIdentityPoolId: null,
    principalOrgId: null,
    sourceIp: "127.0.0.1",
    user: null,
    userAgent: "test-agent",
    userArn: null,
    clientCert: null,
    ...overrides,
  };
}

/**
 * Creates a mock APIGatewayProxyEventV2 (HTTP API v2 format)
 */
export function createAPIGatewayEventV2(
  overrides?: Partial<APIGatewayProxyEventV2>,
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /test",
    rawPath: "/test",
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "123456789012",
      apiId: "test-api-id",
      domainName: "test.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "test",
      http: {
        method: "GET",
        path: "/test",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test-agent",
      },
      requestId: "test-request-id",
      routeKey: "GET /test",
      stage: "$default",
      time: "12/Mar/2020:19:03:58 +0000",
      timeEpoch: 1583348638390,
    },
    body: undefined,
    isBase64Encoded: false,
    ...overrides,
  };
}

/**
 * Creates a mock APIGatewayProxyEvent (REST API format)
 */
export function createAPIGatewayEvent(
  overrides?: Partial<APIGatewayProxyEvent>,
): APIGatewayProxyEvent {
  return {
    resource: "/test",
    path: "/test",
    httpMethod: "GET",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: "123456789012",
      apiId: "test-api-id",
      authorizer: null,
      domainName: "test.execute-api.us-east-1.amazonaws.com",
      domainPrefix: "test",
      extendedRequestId: "test-extended-id",
      httpMethod: "GET",
      identity: createIdentity(),
      path: "/test",
      protocol: "HTTP/1.1",
      requestId: "test-request-id",
      requestTime: "12/Mar/2020:19:03:58 +0000",
      requestTimeEpoch: 1583348638390,
      resourceId: "test-resource-id",
      resourcePath: "/test",
      stage: "dev",
    },
    body: null,
    isBase64Encoded: false,
    ...overrides,
  };
}

/**
 * Creates a mock Lambda Context object
 */
export function createMockContext(overrides?: Partial<Context>): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "test-function",
    functionVersion: "1",
    invokedFunctionArn:
      "arn:aws:lambda:us-east-1:123456789012:function:test-function",
    memoryLimitInMB: "128",
    awsRequestId: "test-request-id",
    logGroupName: "/aws/lambda/test-function",
    logStreamName: "2024/01/01/[$LATEST]test",
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
    ...overrides,
  };
}

/**
 * Creates a mock Lambda Callback function
 */
export function createMockCallback(): Callback {
  return () => {};
}

/**
 * Creates a mock Express Request object
 */
export function createMockRequest(
  overrides?: Partial<Request>,
): Partial<Request> {
  return {
    method: "GET",
    path: "/test",
    url: "/test",
    params: {},
    query: {},
    body: {},
    headers: {},
    cookies: {},
    session: undefined,
    userRef: undefined,
    workspaceResource: undefined,
    ...overrides,
  } as Partial<Request>;
}

/**
 * Creates a mock Express Response object with assertion helpers
 */
export function createMockResponse(): Partial<Response> {
  const response = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    json: vi.fn(function (this: typeof response, data: unknown) {
      this.body = data;
      return this;
    }),
    status: vi.fn(function (this: typeof response, code: number) {
      this.statusCode = code;
      return this;
    }),
    send: vi.fn(function (this: typeof response, data: unknown) {
      this.body = data;
      return this;
    }),
    setHeader: vi.fn(function (
      this: typeof response,
      name: string,
      value: string,
    ) {
      this.headers[name] = value;
      return this;
    }),
  } as Partial<Response> & {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
    json: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };

  return response;
}

/**
 * Creates a mock Express NextFunction
 */
export function createMockNext(): NextFunction {
  return () => {};
}

/**
 * Creates a mock database instance with common table mocks
 * This is a helper that returns a partial mock - tests should extend it as needed
 */
export function createMockDatabase() {
  return {
    agent: {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    workspace: {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    permission: {
      get: async () => null,
      put: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    subscription: {
      get: async () => null,
      put: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    usage: {
      get: async () => null,
      put: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    "agent-key": {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    output_channel: {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    "mcp-server": {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    "email-connection": {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    "workspace-api-key": {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    "workspace-document": {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    "agent-conversations": {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    "user-api-key": {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    "user-refresh-token": {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    "workspace-credit-transactions": {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
    "bot-integration": {
      get: async () => null,
      put: async () => ({}),
      create: async () => ({}),
      update: async () => ({}),
      delete: async () => ({}),
      query: async () => ({ items: [] }),
    },
  };
}
