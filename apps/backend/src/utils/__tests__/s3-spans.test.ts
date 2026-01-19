import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockStartSpan } = vi.hoisted(() => ({
  mockStartSpan: vi.fn(),
}));

vi.mock("../sentry", () => ({
  Sentry: {
    startSpan: mockStartSpan,
  },
}));

import { withS3Span } from "../s3";

describe("withS3Span", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartSpan.mockImplementation(async (_config, callback) => {
      if (typeof callback === "function") {
        return callback();
      }
      return undefined;
    });
  });

  it("wraps the S3 operation in a span", async () => {
    const result = await withS3Span("PutObject", "bucket/key.txt", async () => {
      return "ok";
    });

    expect(result).toBe("ok");
    expect(mockStartSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        op: "aws.s3",
        name: "S3.PutObject",
        attributes: expect.objectContaining({
          "aws.service": "s3",
          "aws.operation": "PutObject",
          "s3.key": "bucket/key.txt",
        }),
      }),
      expect.any(Function)
    );
  });
});
