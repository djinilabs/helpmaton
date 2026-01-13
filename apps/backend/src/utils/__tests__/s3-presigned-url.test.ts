import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock AWS SDK before importing the module
const mockCreatePresignedPost = vi.fn((params, callback) => {
  callback(null, {
    url: "https://s3.amazonaws.com/test-bucket",
    fields: {
      key: params.Fields.key,
      "Content-Type": params.Fields["Content-Type"],
      "x-amz-algorithm": "AWS4-HMAC-SHA256",
      "x-amz-credential": "test-credential",
      "x-amz-date": "20240101T000000Z",
      "x-amz-signature": "test-signature",
    },
  });
});

// Create a proper constructor function
function MockS3() {
  return {
    createPresignedPost: mockCreatePresignedPost,
  };
}

vi.mock("aws-sdk", () => {
  return {
    default: {
      S3: MockS3,
    },
  };
});

// Import after mocks are set up
import { generatePresignedPostUrl } from "../s3";

describe("generatePresignedPostUrl", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      ARC_ENV: "testing",
      HELPMATON_S3_BUCKET: "workspace.documents",
      HELPMATON_S3_ENDPOINT: "http://localhost:4568",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should generate presigned POST URL with correct parameters", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";
    const contentType = "image/jpeg";
    const fileExtension = "jpg";

    const result = await generatePresignedPostUrl(
      workspaceId,
      agentId,
      conversationId,
      contentType,
      fileExtension
    );

    expect(result).toHaveProperty("uploadUrl");
    expect(result).toHaveProperty("fields");
    expect(result).toHaveProperty("finalUrl");
    expect(result).toHaveProperty("expiresIn");
    expect(result.expiresIn).toBe(300); // Default expiration

    // Verify final URL structure
    expect(result.finalUrl).toContain("conversation-files");
    expect(result.finalUrl).toContain(workspaceId);
    expect(result.finalUrl).toContain(agentId);
    expect(result.finalUrl).toContain(conversationId);
    expect(result.finalUrl).toMatch(/\.jpg$/);
  });

  it("should generate high-entropy filename", async () => {
    const result1 = await generatePresignedPostUrl(
      "ws-1",
      "agent-1",
      "conv-1",
      "image/png",
      "png"
    );
    const result2 = await generatePresignedPostUrl(
      "ws-1",
      "agent-1",
      "conv-1",
      "image/png",
      "png"
    );

    // Filenames should be different (high entropy)
    const key1 = result1.fields.key;
    const key2 = result2.fields.key;
    expect(key1).not.toBe(key2);

    // Both should contain the extension
    expect(key1).toMatch(/\.png$/);
    expect(key2).toMatch(/\.png$/);
  });

  it("should handle file extension without dot", async () => {
    const result = await generatePresignedPostUrl(
      "ws-1",
      "agent-1",
      "conv-1",
      "application/pdf",
      "pdf"
    );

    expect(result.finalUrl).toMatch(/\.pdf$/);
  });

  it("should handle file extension with dot", async () => {
    const result = await generatePresignedPostUrl(
      "ws-1",
      "agent-1",
      "conv-1",
      "application/pdf",
      ".pdf"
    );

    expect(result.finalUrl).toMatch(/\.pdf$/);
  });

  it("should work without file extension", async () => {
    const result = await generatePresignedPostUrl(
      "ws-1",
      "agent-1",
      "conv-1",
      "application/octet-stream"
    );

    // Should still generate a valid filename
    expect(result.fields.key).toBeTruthy();
    expect(result.finalUrl).toContain("conversation-files");
  });

  it("should use custom expiration time", async () => {
    const result = await generatePresignedPostUrl(
      "ws-1",
      "agent-1",
      "conv-1",
      "image/jpeg",
      "jpg",
      600 // 10 minutes
    );

    expect(result.expiresIn).toBe(600);
  });

  it("should use custom max file size", async () => {
    const maxSize = 5 * 1024 * 1024; // 5MB
    await generatePresignedPostUrl(
      "ws-1",
      "agent-1",
      "conv-1",
      "image/jpeg",
      "jpg",
      300,
      maxSize
    );

    // Verify that createPresignedPost was called with correct conditions
    expect(mockCreatePresignedPost).toHaveBeenCalled();
    const callArgs = mockCreatePresignedPost.mock.calls[0][0];
    expect(callArgs.Conditions).toEqual(
      expect.arrayContaining([
        ["content-length-range", 0, maxSize],
      ])
    );
  });

  it("should create nested S3 key path", async () => {
    const workspaceId = "workspace-123";
    const agentId = "agent-456";
    const conversationId = "conv-789";

    const result = await generatePresignedPostUrl(
      workspaceId,
      agentId,
      conversationId,
      "image/jpeg",
      "jpg"
    );

    const key = result.fields.key;
    expect(key).toMatch(
      /^conversation-files\/workspace-123\/agent-456\/conv-789\//
    );
  });

  it("should set Content-Type in fields", async () => {
    const contentType = "application/pdf";
    const result = await generatePresignedPostUrl(
      "ws-1",
      "agent-1",
      "conv-1",
      contentType
    );

    expect(result.fields["Content-Type"]).toBe(contentType);
  });

  it("should construct local S3 URL in testing environment", async () => {
    process.env.ARC_ENV = "testing";
    process.env.HELPMATON_S3_ENDPOINT = "http://localhost:4568";

    const result = await generatePresignedPostUrl(
      "ws-1",
      "agent-1",
      "conv-1",
      "image/jpeg"
    );

    expect(result.finalUrl).toMatch(/^http:\/\/localhost:4568\//);
  });

  it("should construct production S3 URL in production environment", async () => {
    process.env.ARC_ENV = "production";
    process.env.NODE_ENV = "production";
    process.env.HELPMATON_S3_REGION = "eu-west-2";

    const result = await generatePresignedPostUrl(
      "ws-1",
      "agent-1",
      "conv-1",
      "image/jpeg"
    );

    expect(result.finalUrl).toMatch(/^https:\/\/s3\.eu-west-2\.amazonaws\.com\//);
  });
});
