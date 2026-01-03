import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  createResponseStream,
  createMockResponseStream,
  writeChunkToStream,
  type HttpResponseStream,
} from "../streamResponseStream";

describe("streamResponseStream", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).awslambda = undefined;
  });

  describe("createResponseStream", () => {
    it("should return stream as-is when awslambda is not available", () => {
      const mockStream: HttpResponseStream = {
        write: vi.fn(),
        end: vi.fn(),
      };
      const result = createResponseStream(mockStream, {});
      expect(result).toBe(mockStream);
    });

    it("should wrap stream with HttpResponseStream.from when awslambda is available", () => {
      const mockFrom = vi.fn((stream) => stream);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).awslambda = {
        HttpResponseStream: {
          from: mockFrom,
        },
      };

      const mockStream: HttpResponseStream = {
        write: vi.fn(),
        end: vi.fn(),
      };
      const headers = { "Content-Type": "text/event-stream" };
      createResponseStream(mockStream, headers);
      expect(mockFrom).toHaveBeenCalledWith(mockStream, {
        statusCode: 200,
        headers,
      });
    });
  });

  describe("createMockResponseStream", () => {
    it("should create a mock stream that buffers chunks", () => {
      const { stream, getBody } = createMockResponseStream();
      stream.write("chunk1");
      stream.write("chunk2");
      stream.write(new TextEncoder().encode("chunk3"));
      expect(getBody()).toBe("chunk1chunk2chunk3");
    });

    it("should handle empty buffer", () => {
      const { stream, getBody } = createMockResponseStream();
      expect(getBody()).toBe("");
    });

    it("should call write callback", () => {
      const { stream } = createMockResponseStream();
      const callback = vi.fn();
      stream.write("test", callback);
      expect(callback).toHaveBeenCalled();
    });

    it("should call end callback", () => {
      const { stream } = createMockResponseStream();
      const callback = vi.fn();
      stream.end(callback);
      expect(callback).toHaveBeenCalled();
    });
  });

  describe("writeChunkToStream", () => {
    it("should resolve when write succeeds", async () => {
      const mockStream: HttpResponseStream = {
        write: vi.fn((chunk, callback) => {
          if (callback) {
            callback();
          }
        }),
        end: vi.fn(),
      };
      await expect(writeChunkToStream(mockStream, "test")).resolves.toBeUndefined();
    });

    it("should reject when write fails", async () => {
      const error = new Error("Write failed");
      const mockStream: HttpResponseStream = {
        write: vi.fn((chunk, callback) => {
          if (callback) {
            callback(error);
          }
        }),
        end: vi.fn(),
      };
      await expect(writeChunkToStream(mockStream, "test")).rejects.toBe(error);
    });

    it("should handle Uint8Array chunks", async () => {
      const mockStream: HttpResponseStream = {
        write: vi.fn((chunk, callback) => {
          if (callback) {
            callback();
          }
        }),
        end: vi.fn(),
      };
      const chunk = new TextEncoder().encode("test");
      await expect(writeChunkToStream(mockStream, chunk)).resolves.toBeUndefined();
    });
  });
});

