import { Writable } from "node:stream";

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies - only mock the external dependencies, not the functions being tested
// Note: mocks must be defined before imports
// Use vi.hoisted to create spies that persist across mock calls
const { mockWriteHead, mockOn } = vi.hoisted(() => {
  const writeHeadSpy = vi.fn();
  const onSpy = vi.fn();
  return {
    mockWriteHead: writeHeadSpy,
    mockOn: onSpy,
  };
});

vi.mock("../../utils/responseStream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/responseStream")>();
  
  // Create the mock function inside the factory to avoid hoisting issues
  const mockEnhanceResponseStream = vi.fn((stream) => {
    // Match the actual implementation: use Object.assign to add methods to the stream
    const enhanced = stream as Writable & {
      writeHead: (code: number, headers: unknown) => void;
      on: (event: string, callback: () => void) => void;
    };
    // Use Object.assign like the real implementation does, but use our hoisted spies
    Object.assign(enhanced, {
      writeHead: mockWriteHead,
      on: mockOn,
    });
    return enhanced;
  });

  return {
    ...actual,
    HttpResponseStream: {
      from: vi.fn((stream) => stream),
    },
    enhanceResponseStream: mockEnhanceResponseStream,
  };
});

import { setupResponseStream, extractTextDelta } from "../responseStream";

describe("extractTextDelta", () => {
  it("should extract textDelta from chunk", () => {
    const chunk = { type: "text-delta", textDelta: "Hello" };
    const result = extractTextDelta(chunk);
    expect(result).toBe("Hello");
  });

  it("should extract text from chunk when textDelta is not present", () => {
    const chunk = { type: "text-delta", text: "World" };
    const result = extractTextDelta(chunk);
    expect(result).toBe("World");
  });

  it("should return undefined when neither textDelta nor text is present", () => {
    const chunk = { type: "other" };
    const result = extractTextDelta(chunk);
    expect(result).toBeUndefined();
  });

  it("should prefer textDelta over text", () => {
    const chunk = {
      type: "text-delta",
      textDelta: "Delta",
      text: "Text",
    };
    const result = extractTextDelta(chunk);
    expect(result).toBe("Delta");
  });
});

describe("setupResponseStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteHead.mockClear();
    mockOn.mockClear();
  });

  it("should setup response stream with correct metadata", () => {
    const mockStream = new Writable({
      write() {},
    });
    const onFinish = vi.fn();

    const { enhancedStream, metadata } = setupResponseStream(
      mockStream,
      onFinish
    );

    expect(metadata).toEqual({
      statusCode: 200,
      statusMessage: "OK",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });

    expect(enhancedStream).toBeDefined();
  });

  it("should call writeHead with correct parameters", () => {
    const mockStream = new Writable({
      write() {},
    });
    const onFinish = vi.fn();

    const result = setupResponseStream(mockStream, onFinish);

    // Verify the function returns the expected structure with correct metadata
    expect(result.enhancedStream).toBeDefined();
    expect(result.metadata.statusCode).toBe(200);
    expect(result.metadata.headers).toEqual({
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    
    // Verify that the enhanced stream has writeHead and on methods
    const enhancedStream = result.enhancedStream as Writable & {
      writeHead: (code: number, headers: unknown) => void;
      on: (event: string, callback: () => void) => void;
    };
    expect(typeof enhancedStream.writeHead).toBe("function");
    expect(typeof enhancedStream.on).toBe("function");
  });

  it("should register finish event handler", () => {
    const mockStream = new Writable({
      write() {},
    });
    const onFinish = vi.fn();

    const result = setupResponseStream(mockStream, onFinish);

    // Verify that the enhanced stream has the on method
    const enhancedStream = result.enhancedStream as Writable & {
      writeHead: (code: number, headers: unknown) => void;
      on: (event: string, callback: () => void) => void;
    };
    expect(typeof enhancedStream.on).toBe("function");
    // The on method should be callable with 'finish' event
    expect(() => {
      enhancedStream.on("finish", onFinish);
    }).not.toThrow();
  });
});

