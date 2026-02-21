import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  createResponseStream,
  createMockResponseStream,
  isStreamWritable,
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
      const mockStream = {
        write: vi.fn(() => true),
        end: vi.fn(() => mockStream),
      } as unknown as HttpResponseStream;
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

      const mockStream = {
        write: vi.fn(() => true),
        end: vi.fn(() => mockStream),
      } as unknown as HttpResponseStream;
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
      const { getBody } = createMockResponseStream();
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

    it("should report writable false and invoke write callback with error after end (write after end)", async () => {
      const { stream, getBody } = createMockResponseStream();
      stream.write("before");
      stream.end();
      expect(getBody()).toBe("before");
      await expect(
        writeChunkToStream(stream, "after end")
      ).rejects.toThrow("write after end");
      expect(getBody()).toBe("before");
    });
  });

  describe("isStreamWritable", () => {
    it("returns true for mock stream that has not been ended", () => {
      const { stream } = createMockResponseStream();
      expect(isStreamWritable(stream)).toBe(true);
    });

    it("returns false for mock stream after end()", () => {
      const { stream } = createMockResponseStream();
      stream.end();
      expect(isStreamWritable(stream)).toBe(false);
    });

    it("returns true for stream without writable/writableEnded (backward compat)", () => {
      const stream = {
        write: vi.fn(() => true),
        end: vi.fn(),
      } as unknown as HttpResponseStream;
      expect(isStreamWritable(stream)).toBe(true);
    });

    it("returns false when writable is explicitly false and writableEnded is undefined", () => {
      const stream = {
        writable: false,
        write: vi.fn(() => true),
        end: vi.fn(),
      } as unknown as HttpResponseStream;
      expect(isStreamWritable(stream)).toBe(false);
    });

    it("returns false when writable is explicitly false and writableEnded is false", () => {
      const stream = {
        writable: false,
        writableEnded: false,
        write: vi.fn(() => true),
        end: vi.fn(),
      } as unknown as HttpResponseStream;
      expect(isStreamWritable(stream)).toBe(false);
    });
  });

  describe("writeChunkToStream", () => {
    it("should resolve when write succeeds", async () => {
      const mockStream = {
        write: vi.fn((chunk, callback) => {
          if (callback) {
            callback();
          }
          return true;
        }),
        end: vi.fn(() => mockStream),
      } as unknown as HttpResponseStream;
      await expect(writeChunkToStream(mockStream, "test")).resolves.toBeUndefined();
    });

    it("should reject when write fails", async () => {
      const error = new Error("Write failed");
      const mockStream = {
        write: vi.fn((chunk, callback) => {
          if (callback) {
            callback(error);
          }
          return true;
        }),
        end: vi.fn(() => mockStream),
      } as unknown as HttpResponseStream;
      await expect(writeChunkToStream(mockStream, "test")).rejects.toBe(error);
    });

    it("should handle Uint8Array chunks", async () => {
      const mockStream = {
        write: vi.fn((chunk, callback) => {
          if (callback) {
            callback();
          }
          return true;
        }),
        end: vi.fn(() => mockStream),
      } as unknown as HttpResponseStream;
      const chunk = new TextEncoder().encode("test");
      await expect(writeChunkToStream(mockStream, chunk)).resolves.toBeUndefined();
    });
  });
});

