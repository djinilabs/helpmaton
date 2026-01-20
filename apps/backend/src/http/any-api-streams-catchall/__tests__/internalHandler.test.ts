import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import { resolveAwsRequestId } from "../internalHandler";

describe("resolveAwsRequestId", () => {
  const baseEvent = (): APIGatewayProxyEventV2 =>
    ({
      version: "2.0",
      routeKey: "$default",
      rawPath: "/api/streams",
      rawQueryString: "",
      headers: {},
      requestContext: {
        accountId: "123",
        apiId: "api",
        domainName: "example.com",
        domainPrefix: "example",
        http: {
          method: "GET",
          path: "/api/streams",
          protocol: "HTTP/1.1",
          sourceIp: "127.0.0.1",
          userAgent: "test",
        },
        requestId: "req-original",
        routeKey: "$default",
        stage: "test",
        time: "01/Jan/2024:00:00:00 +0000",
        timeEpoch: 1704067200000,
      },
      isBase64Encoded: false,
    }) satisfies APIGatewayProxyEventV2;

  it("prefers requestId already on normalized event", () => {
    const event = baseEvent();
    const httpV2Event = {
      ...event,
      requestContext: {
        ...event.requestContext,
        requestId: "req-normalized",
      },
    };

    const result = resolveAwsRequestId(event, httpV2Event);

    expect(result).toBe("req-normalized");
    expect(httpV2Event.requestContext.requestId).toBe("req-normalized");
  });

  it("falls back to original event requestId", () => {
    const event = baseEvent();
    const httpV2Event = {
      ...event,
      requestContext: {
        ...event.requestContext,
        requestId: "",
      },
    };

    const result = resolveAwsRequestId(event, httpV2Event);

    expect(result).toBe("req-original");
    expect(httpV2Event.requestContext.requestId).toBe("req-original");
  });

  it("generates requestId when missing", () => {
    const event = baseEvent();
    const httpV2Event = {
      ...event,
      requestContext: {
        ...event.requestContext,
        requestId: "",
      },
    };
    const originalEvent = {
      ...event,
      requestContext: {
        ...event.requestContext,
        requestId: "",
      },
    };

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(123456789);
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.123456);

    const result = resolveAwsRequestId(originalEvent, httpV2Event);

    expect(result.startsWith("gen-123456789-")).toBe(true);
    expect(httpV2Event.requestContext.requestId).toBe(result);

    dateSpy.mockRestore();
    randomSpy.mockRestore();
  });
});
