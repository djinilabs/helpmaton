import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyResultV2,
  Context,
  Callback,
} from "aws-lambda";
import { describe, it, expect, vi } from "vitest";

import {
  adaptHttpHandler,
  transformLambdaUrlToHttpV2Event,
  type LambdaUrlEvent,
} from "../httpEventAdapter";

// Helper to create a minimal valid identity object
function createIdentity(overrides?: Partial<APIGatewayProxyEvent["requestContext"]["identity"]>) {
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

describe("adaptHttpHandler", () => {
  const mockContext: Context = {
    callbackWaitsForEmptyEventLoop: false,
    functionName: "test-function",
    functionVersion: "1",
    invokedFunctionArn: "arn:aws:lambda:us-east-1:123456789012:function:test",
    memoryLimitInMB: "128",
    awsRequestId: "test-request-id",
    logGroupName: "/aws/lambda/test",
    logStreamName: "2024/01/01/[$LATEST]test",
    getRemainingTimeInMillis: () => 30000,
    done: vi.fn(),
    fail: vi.fn(),
    succeed: vi.fn(),
  };

  const mockCallback: Callback = vi.fn();

  describe("HTTP v2 event handling", () => {
    it("should pass through HTTP v2 events unchanged", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({ message: "Success" }),
        headers: {
          "Content-Type": "application/json",
        },
      });

      const httpV2Event: APIGatewayProxyEventV2 = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "foo=bar",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer token123",
        },
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
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
        body: "",
        isBase64Encoded: false,
        queryStringParameters: {
          foo: "bar",
        },
        pathParameters: {
          id: "123",
        },
        stageVariables: {
          env: "test",
        },
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      const result = await adaptedHandler(httpV2Event, mockContext, mockCallback);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith(
        httpV2Event,
        mockContext,
        mockCallback
      );
      expect(result).toEqual({
        statusCode: 200,
        body: JSON.stringify({ message: "Success" }),
        headers: {
          "Content-Type": "application/json",
        },
      });
    });
  });

  describe("REST event conversion", () => {
    it("should convert REST event to HTTP v2 format", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
      });

      const restEvent: APIGatewayProxyEvent = {
        resource: "/test",
        path: "/test",
        httpMethod: "GET",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer token123",
        },
        multiValueHeaders: {},
        queryStringParameters: {
          foo: "bar",
          baz: "qux",
        },
        multiValueQueryStringParameters: null,
        pathParameters: {
          id: "123",
        },
        stageVariables: {
          env: "test",
        },
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      await adaptedHandler(restEvent, mockContext, mockCallback);

      expect(mockHandler).toHaveBeenCalledTimes(1);
      const calledEvent = mockHandler.mock.calls[0][0] as APIGatewayProxyEventV2;

      expect(calledEvent.version).toBe("2.0");
      expect(calledEvent.routeKey).toBe("GET /test"); // HTTP API v2 routeKey format is "METHOD /path"
      expect(calledEvent.rawPath).toBe("/test");
      expect(calledEvent.rawQueryString).toBe("foo=bar&baz=qux");
      // HTTP API v2 headers are normalized to lowercase
      expect(calledEvent.headers).toEqual({
        "content-type": "application/json",
        "authorization": "Bearer token123",
      });
      expect(calledEvent.queryStringParameters).toEqual({
        foo: "bar",
        baz: "qux",
      });
      expect(calledEvent.pathParameters).toEqual({ id: "123" });
      expect(calledEvent.stageVariables).toEqual({ env: "test" });
      expect(calledEvent.body).toBeUndefined(); // REST null is converted to undefined for HTTP v2
      expect(calledEvent.isBase64Encoded).toBe(false);

      expect(calledEvent.requestContext.http.method).toBe("GET");
      expect(calledEvent.requestContext.http.path).toBe("/test");
      expect(calledEvent.requestContext.http.protocol).toBe("HTTP/1.1");
      expect(calledEvent.requestContext.http.sourceIp).toBe("127.0.0.1");
      expect(calledEvent.requestContext.http.userAgent).toBe("test-agent");
      expect(calledEvent.requestContext.accountId).toBe("123456789012");
      expect(calledEvent.requestContext.apiId).toBe("api-id");
      expect(calledEvent.requestContext.requestId).toBe("test-request-id");
      expect(calledEvent.requestContext.stage).toBe("dev");
    });

    it("should convert multi-value headers to single-value headers", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
      });

      const restEvent: APIGatewayProxyEvent = {
        resource: "/test",
        path: "/test",
        httpMethod: "GET",
        headers: {},
        multiValueHeaders: {
          "Content-Type": ["application/json"],
          "X-Custom-Header": ["value1", "value2"],
          "Authorization": ["Bearer token123"],
        },
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      await adaptedHandler(restEvent, mockContext, mockCallback);

      const calledEvent = mockHandler.mock.calls[0][0] as APIGatewayProxyEventV2;
      // HTTP API v2 headers are normalized to lowercase
      expect(calledEvent.headers).toEqual({
        "content-type": "application/json",
        "x-custom-header": "value1", // First value taken
        "authorization": "Bearer token123",
      });
    });

    it("should prefer multiValueHeaders over headers when both are present", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
      });

      const restEvent: APIGatewayProxyEvent = {
        resource: "/test",
        path: "/test",
        httpMethod: "GET",
        headers: {
          "Content-Type": "text/plain", // This should be ignored
        },
        multiValueHeaders: {
          "Content-Type": ["application/json"], // This should be used
        },
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      await adaptedHandler(restEvent, mockContext, mockCallback);

      const calledEvent = mockHandler.mock.calls[0][0] as APIGatewayProxyEventV2;
      // HTTP API v2 headers are normalized to lowercase
      expect(calledEvent.headers).toEqual({
        "content-type": "application/json",
      });
    });

    it("should convert multi-value query string parameters to single-value parameters", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
      });

      const restEvent: APIGatewayProxyEvent = {
        resource: "/test",
        path: "/test",
        httpMethod: "GET",
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: {
          foo: ["bar"],
          baz: ["qux", "quux"], // First value should be taken
        },
        pathParameters: null,
        stageVariables: null,
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      await adaptedHandler(restEvent, mockContext, mockCallback);

      const calledEvent = mockHandler.mock.calls[0][0] as APIGatewayProxyEventV2;
      expect(calledEvent.queryStringParameters).toEqual({
        foo: "bar",
        baz: "qux", // First value taken
      });
      expect(calledEvent.rawQueryString).toBe("foo=bar&baz=qux");
    });

    it("should prefer multiValueQueryStringParameters over queryStringParameters when both are present", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
      });

      const restEvent: APIGatewayProxyEvent = {
        resource: "/test",
        path: "/test",
        httpMethod: "GET",
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: {
          foo: "ignored", // This should be ignored
        },
        multiValueQueryStringParameters: {
          foo: ["bar"], // This should be used
        },
        pathParameters: null,
        stageVariables: null,
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      await adaptedHandler(restEvent, mockContext, mockCallback);

      const calledEvent = mockHandler.mock.calls[0][0] as APIGatewayProxyEventV2;
      expect(calledEvent.queryStringParameters).toEqual({
        foo: "bar",
      });
    });

    it("should handle missing headers gracefully", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
      });

      const restEvent: APIGatewayProxyEvent = {
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
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      await adaptedHandler(restEvent, mockContext, mockCallback);

      const calledEvent = mockHandler.mock.calls[0][0] as APIGatewayProxyEventV2;
      expect(calledEvent.headers).toEqual({});
    });

    it("should preserve body and base64 encoding", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
      });

      const bodyContent = JSON.stringify({ message: "Hello World" });
      const base64Body = Buffer.from(bodyContent).toString("base64");

      const restEvent: APIGatewayProxyEvent = {
        resource: "/test",
        path: "/test",
        httpMethod: "POST",
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "POST",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: base64Body,
        isBase64Encoded: true,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      await adaptedHandler(restEvent, mockContext, mockCallback);

      const calledEvent = mockHandler.mock.calls[0][0] as APIGatewayProxyEventV2;
      expect(calledEvent.body).toBe(base64Body);
      expect(calledEvent.isBase64Encoded).toBe(true);
    });

    it("should extract cookies from Cookie header in REST API events", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
      });

      const restEvent: APIGatewayProxyEvent = {
        resource: "/test",
        path: "/test",
        httpMethod: "GET",
        headers: {
          "Cookie": "session=abc123; auth-token=xyz789",
        },
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      await adaptedHandler(restEvent, mockContext, mockCallback);

      const calledEvent = mockHandler.mock.calls[0][0] as APIGatewayProxyEventV2;
      // Cookies should be extracted from Cookie header and converted to array
      expect(calledEvent.cookies).toEqual(["session=abc123", "auth-token=xyz789"]);
    });

    it("should convert multiValueHeaders to headers in REST API responses", async () => {
      // multiValueHeaders is not in the TypeScript type, but serverless-express might return it
      // Create a type that includes multiValueHeaders for testing
      type HandlerResultWithMultiValueHeaders = APIGatewayProxyResultV2 & {
        multiValueHeaders?: Record<string, string[]>;
      };
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
        multiValueHeaders: {
          "Content-Type": ["application/json"],
          "X-Custom-Header": ["value1", "value2"],
        },
      } as HandlerResultWithMultiValueHeaders);

      const restEvent: APIGatewayProxyEvent = {
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
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      const result = await adaptedHandler(restEvent, mockContext, mockCallback);

      // multiValueHeaders should be converted to headers (first value taken)
      expect(result).toEqual({
        statusCode: 200,
        body: "OK",
        headers: {
          "Content-Type": "application/json",
          "X-Custom-Header": "value1", // First value taken
        },
      });
      // multiValueHeaders should not be in the response
      expect((result as Record<string, unknown>).multiValueHeaders).toBeUndefined();
    });

    it("should convert cookies array to Set-Cookie header in REST API responses", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
        // cookies is in APIGatewayProxyResultV2, but let's be explicit
        cookies: ["session=abc123", "auth-token=xyz789"],
      } as APIGatewayProxyResultV2);

      const restEvent: APIGatewayProxyEvent = {
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
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      const result = await adaptedHandler(restEvent, mockContext, mockCallback);

      // cookies array should be converted to Set-Cookie header (first cookie only due to REST API limitation)
      expect(result).toEqual({
        statusCode: 200,
        body: "OK",
        headers: {
          "Set-Cookie": "session=abc123", // First cookie only (REST API limitation)
        },
      });
      // cookies should not be in the response
      expect((result as Record<string, unknown>).cookies).toBeUndefined();
    });

    it("should decode base64-encoded responses for REST API events", async () => {
      const htmlContent = "<html><body>Hello</body></html>";
      const base64Html = Buffer.from(htmlContent).toString("base64");

      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: base64Html,
        isBase64Encoded: true,
        headers: {
          "Content-Type": "text/html",
        },
      });

      const restEvent: APIGatewayProxyEvent = {
        resource: "/",
        path: "/",
        httpMethod: "GET",
        headers: {},
        multiValueHeaders: {},
        queryStringParameters: null,
        multiValueQueryStringParameters: null,
        pathParameters: null,
        stageVariables: null,
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      const result = await adaptedHandler(restEvent, mockContext, mockCallback);

      // For REST API events, base64-encoded responses should be decoded
      expect(result).toEqual({
        statusCode: 200,
        body: htmlContent, // Decoded, not base64
        isBase64Encoded: false,
        headers: {
          "Content-Type": "text/html",
        },
      });
    });

    it("should handle missing requestContext fields gracefully", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
      });

      const restEvent: APIGatewayProxyEvent = {
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
          apiId: "api-id",
          authorizer: null,
          domainName: undefined,
          domainPrefix: undefined,
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity({
            sourceIp: undefined as unknown as string,
            userAgent: undefined as unknown as string,
          }),
          path: undefined as unknown as string,
          protocol: undefined as unknown as string,
          requestId: "test-request-id",
          requestTime: undefined as unknown as string,
          requestTimeEpoch: undefined as unknown as number,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: undefined as unknown as string,
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      await adaptedHandler(restEvent, mockContext, mockCallback);

      const calledEvent = mockHandler.mock.calls[0][0] as APIGatewayProxyEventV2;
      expect(calledEvent.requestContext.domainName).toBe("");
      expect(calledEvent.requestContext.http.sourceIp).toBe("");
      expect(calledEvent.requestContext.http.userAgent).toBe("");
      expect(calledEvent.requestContext.http.path).toBe("/test"); // Falls back to event.path
      expect(calledEvent.requestContext.http.protocol).toBe("HTTP/1.1"); // Default
      expect(calledEvent.requestContext.stage).toBe("$default"); // Default
    });

    it("should handle missing resource field", async () => {
      const mockHandler = vi.fn<APIGatewayProxyHandlerV2>().mockResolvedValue({
        statusCode: 200,
        body: "OK",
      });

      const restEvent: APIGatewayProxyEvent = {
        resource: "$default",
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
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      await adaptedHandler(restEvent, mockContext, mockCallback);

      const calledEvent = mockHandler.mock.calls[0][0] as APIGatewayProxyEventV2;
      expect(calledEvent.routeKey).toBe("GET $default"); // HTTP API v2 routeKey format is "METHOD /path"
    });
  });

  describe("Handler result handling", () => {
    it("should return handler result for HTTP v2 events", async () => {
      const expectedResult: APIGatewayProxyResultV2 = {
        statusCode: 201,
        body: JSON.stringify({ created: true }),
        headers: {
          "Content-Type": "application/json",
          "Location": "/resource/123",
        },
      };

      const mockHandler = vi
        .fn<APIGatewayProxyHandlerV2>()
        .mockResolvedValue(expectedResult);

      const httpV2Event: APIGatewayProxyEventV2 = {
        version: "2.0",
        routeKey: "POST /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {},
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          http: {
            method: "POST",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test-agent",
          },
          requestId: "test-request-id",
          routeKey: "POST /test",
          stage: "$default",
          time: "12/Mar/2020:19:03:58 +0000",
          timeEpoch: 1583348638390,
        },
        body: JSON.stringify({ data: "test" }),
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      const result = await adaptedHandler(httpV2Event, mockContext, mockCallback);

      expect(result).toEqual(expectedResult);
    });

    it("should return handler result for REST events", async () => {
      const expectedResult: APIGatewayProxyResultV2 = {
        statusCode: 200,
        body: "OK",
      };

      const mockHandler = vi
        .fn<APIGatewayProxyHandlerV2>()
        .mockResolvedValue(expectedResult);

      const restEvent: APIGatewayProxyEvent = {
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
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);
      const result = await adaptedHandler(restEvent, mockContext, mockCallback);

      expect(result).toEqual(expectedResult);
    });
  });

  describe("Error handling", () => {
    it("should propagate errors from handler", async () => {
      const error = new Error("Handler error");
      const mockHandler = vi
        .fn<APIGatewayProxyHandlerV2>()
        .mockRejectedValue(error);

      const httpV2Event: APIGatewayProxyEventV2 = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {},
        requestContext: {
          accountId: "123456789012",
          apiId: "api-id",
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
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
        body: "",
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);

      await expect(
        adaptedHandler(httpV2Event, mockContext, mockCallback)
      ).rejects.toThrow("Handler error");
    });

    it("should propagate errors from handler for REST events", async () => {
      const error = new Error("Handler error");
      const mockHandler = vi
        .fn<APIGatewayProxyHandlerV2>()
        .mockRejectedValue(error);

      const restEvent: APIGatewayProxyEvent = {
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
          apiId: "api-id",
          authorizer: null,
          domainName: "id.execute-api.us-east-1.amazonaws.com",
          domainPrefix: "id",
          extendedRequestId: "extended-id",
          httpMethod: "GET",
          identity: createIdentity(),
          path: "/test",
          protocol: "HTTP/1.1",
          requestId: "test-request-id",
          requestTime: "12/Mar/2020:19:03:58 +0000",
          requestTimeEpoch: 1583348638390,
          resourceId: "resource-id",
          resourcePath: "/test",
          stage: "dev",
        },
        body: null,
        isBase64Encoded: false,
      };

      const adaptedHandler = adaptHttpHandler(mockHandler);

      await expect(
        adaptedHandler(restEvent, mockContext, mockCallback)
      ).rejects.toThrow("Handler error");
    });
  });

  describe("transformLambdaUrlToHttpV2Event", () => {
    it("should transform Lambda URL event to HTTP v2 format", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "POST /api/streams/workspace-123/agent-456/secret-789",
        rawPath: "/api/streams/workspace-123/agent-456/secret-789",
        rawQueryString: "foo=bar&baz=qux",
        headers: {
          "Content-Type": "text/plain",
          "Origin": "https://example.com",
          "Cookie": "session=abc123; token=xyz789",
        },
        requestContext: {
          http: {
            method: "POST",
            path: "/api/streams/workspace-123/agent-456/secret-789",
            protocol: "HTTP/1.1",
            sourceIp: "192.168.1.1",
            userAgent: "test-agent/1.0",
          },
          requestId: "test-request-id",
          accountId: "123456789012",
          apiId: "lambda-url-api",
          domainName: "abc123.lambda-url.eu-west-2.on.aws",
          domainPrefix: "abc123",
          stage: "$default",
          time: "12/Mar/2024:19:03:58 +0000",
          timeEpoch: 1710273838000,
        },
        body: "Hello, world!",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.version).toBe("2.0");
      expect(result.routeKey).toBe(
        "POST /api/streams/workspace-123/agent-456/secret-789"
      );
      expect(result.rawPath).toBe("/api/streams/workspace-123/agent-456/secret-789");
      expect(result.rawQueryString).toBe("foo=bar&baz=qux");
      expect(result.body).toBe("Hello, world!");
      expect(result.isBase64Encoded).toBe(false);
    });

    it("should normalize headers to lowercase", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer token",
          "X-Custom-Header": "value",
        },
        requestContext: {
          http: {
            method: "GET",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.headers["content-type"]).toBe("application/json");
      expect(result.headers["authorization"]).toBe("Bearer token");
      expect(result.headers["x-custom-header"]).toBe("value");
      expect(result.headers["Content-Type"]).toBeUndefined();
    });

    it("should extract cookies from Cookie header", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {
          Cookie: "session=abc123; token=xyz789; lang=en",
        },
        requestContext: {
          http: {
            method: "GET",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.cookies).toEqual(["session=abc123", "token=xyz789", "lang=en"]);
      expect(result.headers.cookie).toBeUndefined();
    });

    it("should handle missing Cookie header", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {},
        requestContext: {
          http: {
            method: "GET",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.cookies).toBeUndefined();
    });

    it("should parse query string parameters", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "foo=bar&baz=qux&empty=",
        headers: {},
        requestContext: {
          http: {
            method: "GET",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.queryStringParameters).toEqual({
        foo: "bar",
        baz: "qux",
        empty: "",
      });
    });

    it("should handle empty query string", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {},
        requestContext: {
          http: {
            method: "GET",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.queryStringParameters).toBeUndefined();
    });

    it("should extract path parameters from stream route pattern", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "POST /api/streams/workspace-123/agent-456/secret-789",
        rawPath: "/api/streams/workspace-123/agent-456/secret-789",
        rawQueryString: "",
        headers: {},
        requestContext: {
          http: {
            method: "POST",
            path: "/api/streams/workspace-123/agent-456/secret-789",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.pathParameters).toEqual({
        workspaceId: "workspace-123",
        agentId: "agent-456",
        secret: "secret-789",
      });
    });

    it("should handle path that doesn't match stream pattern", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /api/other/route",
        rawPath: "/api/other/route",
        rawQueryString: "",
        headers: {},
        requestContext: {
          http: {
            method: "GET",
            path: "/api/other/route",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.pathParameters).toBeUndefined();
    });

    it("should handle base64 encoded body", () => {
      const encodedBody = Buffer.from("Hello, world!").toString("base64");
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "POST /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {},
        requestContext: {
          http: {
            method: "POST",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: encodedBody,
        isBase64Encoded: true,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.body).toBe(encodedBody);
      expect(result.isBase64Encoded).toBe(true);
    });

    it("should handle missing body", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {},
        requestContext: {
          http: {
            method: "GET",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.body).toBeUndefined();
    });

    it("should build requestContext correctly", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {},
        requestContext: {
          http: {
            method: "GET",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "192.168.1.1",
            userAgent: "test-agent/1.0",
          },
          requestId: "req-123",
          accountId: "123456789012",
          apiId: "api-456",
          domainName: "abc.lambda-url.region.on.aws",
          domainPrefix: "abc",
          stage: "prod",
          time: "12/Mar/2024:19:03:58 +0000",
          timeEpoch: 1710273838000,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.requestContext.http.method).toBe("GET");
      expect(result.requestContext.http.path).toBe("/test");
      expect(result.requestContext.http.protocol).toBe("HTTP/1.1");
      expect(result.requestContext.http.sourceIp).toBe("192.168.1.1");
      expect(result.requestContext.http.userAgent).toBe("test-agent/1.0");
      expect(result.requestContext.requestId).toBe("req-123");
      expect(result.requestContext.accountId).toBe("123456789012");
      expect(result.requestContext.apiId).toBe("api-456");
      expect(result.requestContext.domainName).toBe("abc.lambda-url.region.on.aws");
      expect(result.requestContext.domainPrefix).toBe("abc");
      expect(result.requestContext.stage).toBe("prod");
      expect(result.requestContext.time).toBe("12/Mar/2024:19:03:58 +0000");
      expect(result.requestContext.timeEpoch).toBe(1710273838000);
    });

    it("should handle missing requestContext fields with defaults", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {},
        requestContext: {
          http: {
            method: "GET",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.requestContext.accountId).toBe("");
      expect(result.requestContext.apiId).toBe("");
      expect(result.requestContext.domainName).toBe("");
      expect(result.requestContext.domainPrefix).toBe("");
      expect(result.requestContext.stage).toBe("$default");
      expect(result.requestContext.time).toBeDefined();
      expect(result.requestContext.timeEpoch).toBeGreaterThan(0);
    });

    it("should handle undefined headers", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {},
        requestContext: {
          http: {
            method: "GET",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.headers).toEqual({});
    });

    it("should handle headers with undefined values", () => {
      const lambdaEvent: LambdaUrlEvent = {
        version: "2.0",
        routeKey: "GET /test",
        rawPath: "/test",
        rawQueryString: "",
        headers: {
          "Content-Type": "application/json",
          "X-Undefined": undefined as unknown as string,
          "X-Empty": "",
        },
        requestContext: {
          http: {
            method: "GET",
            path: "/test",
            protocol: "HTTP/1.1",
            sourceIp: "127.0.0.1",
            userAgent: "test",
          },
          requestId: "test",
          accountId: "",
          apiId: "",
          domainName: "",
          domainPrefix: "",
          stage: "",
          time: "",
          timeEpoch: 0,
        },
        body: "",
        isBase64Encoded: false,
      };

      const result = transformLambdaUrlToHttpV2Event(lambdaEvent);

      expect(result.headers["content-type"]).toBe("application/json");
      expect(result.headers["x-undefined"]).toBeUndefined();
      expect(result.headers["x-empty"]).toBe("");
    });
  });
});

