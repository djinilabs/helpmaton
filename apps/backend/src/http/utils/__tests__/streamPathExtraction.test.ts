import { describe, expect, it } from "vitest";

import type { LambdaUrlEvent } from "../../../utils/httpEventAdapter";
import { extractStreamPathParameters } from "../streamPathExtraction";

import { createAPIGatewayEventV2 } from "./test-helpers";

describe("streamPathExtraction", () => {
  describe("extractStreamPathParameters", () => {
    it("should extract parameters for 'url' endpoint", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/url",
      });
      const result = extractStreamPathParameters(event);
      expect(result).toEqual({
        workspaceId: "",
        agentId: "",
        endpointType: "url",
      });
    });

    it("should extract parameters for 'test' endpoint", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/workspace123/agent456/test",
      });
      const result = extractStreamPathParameters(event);
      expect(result).toEqual({
        workspaceId: "workspace123",
        agentId: "agent456",
        endpointType: "test",
      });
    });

    it("should extract parameters for 'stream' endpoint", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/workspace123/agent456/secret789",
        pathParameters: {
          workspaceId: "workspace123",
          agentId: "agent456",
          secret: "secret789",
        },
      });
      const result = extractStreamPathParameters(event);
      expect(result).toEqual({
        workspaceId: "workspace123",
        agentId: "agent456",
        secret: "secret789",
        endpointType: "stream",
      });
    });

    it("should extract from path when pathParameters are missing", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/workspace123/agent456/secret789",
      });
      const result = extractStreamPathParameters(event);
      expect(result).toEqual({
        workspaceId: "workspace123",
        agentId: "agent456",
        secret: "secret789",
        endpointType: "stream",
      });
    });

    it("should handle catchall route with proxy parameter", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "",
        pathParameters: {
          proxy: "workspace123/agent456/secret789",
        },
      });
      const result = extractStreamPathParameters(event);
      expect(result).toEqual({
        workspaceId: "workspace123",
        agentId: "agent456",
        secret: "secret789",
        endpointType: "stream",
      });
    });

    it("should return null when workspaceId is missing", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/agent456/secret789",
      });
      const result = extractStreamPathParameters(event);
      expect(result).toBeNull();
    });

    it("should return null when agentId is missing", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/workspace123/secret789",
      });
      const result = extractStreamPathParameters(event);
      expect(result).toBeNull();
    });

    it("should return null when secret is missing for stream endpoint", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/workspace123/agent456",
      });
      const result = extractStreamPathParameters(event);
      expect(result).toBeNull();
    });

    it("should handle secret with slashes", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "/api/streams/workspace123/agent456/secret/with/slashes",
      });
      const result = extractStreamPathParameters(event);
      expect(result).toEqual({
        workspaceId: "workspace123",
        agentId: "agent456",
        secret: "secret/with/slashes",
        endpointType: "stream",
      });
    });

    it("should normalize path with multiple leading slashes", () => {
      const event = createAPIGatewayEventV2({
        rawPath: "///api/streams/workspace123/agent456/test",
      });
      const result = extractStreamPathParameters(event);
      expect(result).toEqual({
        workspaceId: "workspace123",
        agentId: "agent456",
        endpointType: "test",
      });
    });
  });
});

