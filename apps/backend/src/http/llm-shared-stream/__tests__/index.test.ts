import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInternalHandler } = vi.hoisted(() => ({
  mockInternalHandler: vi.fn(),
}));

vi.mock("lambda-stream", () => ({
  streamifyResponse: (handler: unknown) => handler,
}));

vi.mock("../../any-api-streams-catchall/internalHandler", () => ({
  internalHandler: mockInternalHandler,
}));

import type { HttpResponseStream } from "../../utils/streamResponseStream";
import { handler } from "../index";

describe("llm-shared-stream handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the response stream to internal handler", async () => {
    const responseStream = {
      write: vi.fn(),
      end: vi.fn(),
    } as unknown as HttpResponseStream;
    const event = {
      version: "2.0",
      routeKey: "POST /api/streams/workspace123/agent456/test",
      rawPath: "/api/streams/workspace123/agent456/test",
      rawQueryString: "",
      requestContext: {
        http: {
          method: "POST",
          path: "/api/streams/workspace123/agent456/test",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "test-agent",
        },
        requestId: "test-request-id",
        accountId: "123456789012",
        apiId: "test-api",
        domainName: "test.execute-api.us-east-1.amazonaws.com",
        domainPrefix: "test",
        stage: "$default",
        time: "12/Mar/2020:19:03:58 +0000",
        timeEpoch: 1583348638390,
      },
      headers: {},
      body: "[]",
      isBase64Encoded: false,
    };

    await handler(event, responseStream);

    expect(mockInternalHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        rawPath: "/api/streams/workspace123/agent456/test",
      }),
      responseStream,
    );
  });
});
