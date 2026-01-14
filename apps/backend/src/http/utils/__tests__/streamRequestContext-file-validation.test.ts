import { badRequest } from "@hapi/boom";
import { describe, it, expect } from "vitest";

import type { UIMessage } from "../../../utils/messageTypes";

/**
 * Test helper to validate file parts in messages
 * This mirrors the validation logic in streamRequestContext.ts
 */
function validateFilePartsInMessages(messages: UIMessage[]): void {
  for (const msg of messages) {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && typeof part === "object" && "type" in part) {
          const partType = part.type;
          if (partType === "file" && "file" in part) {
            const filePart = part as { type: "file"; file: unknown };
            const fileUrl = filePart.file;
            if (typeof fileUrl === "string") {
              // Reject base64/data URLs - check for both "data:" and "data;"
              if (
                fileUrl.startsWith("data:") ||
                fileUrl.startsWith("data;")
              ) {
                throw badRequest(
                  "Inline file data (base64/data URLs) is not allowed. Files must be uploaded to S3 first."
                );
              }
              // Ensure it's a valid URL
              if (
                !fileUrl.startsWith("http://") &&
                !fileUrl.startsWith("https://")
              ) {
                throw badRequest(
                  "File URL must be a valid HTTP/HTTPS URL"
                );
              }
            } else if (fileUrl !== null && fileUrl !== undefined) {
              // File URL must be a string
              throw badRequest(
                "File content must be a URL string, not inline data"
              );
            }
          }
        }
      }
    }
  }
}

describe("File Parts Validation", () => {

  it("should accept valid S3 URLs in file parts", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Please review" },
          {
            type: "file",
            file: "https://s3.amazonaws.com/bucket/file.pdf",
            mediaType: "application/pdf",
          },
        ],
      },
    ];

    expect(() => validateFilePartsInMessages(messages)).not.toThrow();
  });

  it("should reject base64 data URLs", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            file: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
            mediaType: "image/jpeg",
          },
        ],
      },
    ];

    expect(() => validateFilePartsInMessages(messages)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("Inline file data (base64/data URLs) is not allowed"),
      })
    );
  });

  it("should reject data URLs with data; prefix", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            file: "data;image/jpeg;base64,/9j/4AAQSkZJRg==",
            mediaType: "image/jpeg",
          },
        ],
      },
    ];

    expect(() => validateFilePartsInMessages(messages)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("Inline file data (base64/data URLs) is not allowed"),
      })
    );
  });

  it("should reject non-HTTP URLs", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            file: "file:///path/to/file.pdf",
            mediaType: "application/pdf",
          },
        ],
      },
    ];

    expect(() => validateFilePartsInMessages(messages)).toThrow(
      badRequest("File URL must be a valid HTTP/HTTPS URL")
    );
  });

  it("should accept HTTP URLs", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            file: "http://example.com/file.pdf",
            mediaType: "application/pdf",
          },
        ],
      },
    ];

    expect(() => validateFilePartsInMessages(messages)).not.toThrow();
  });

  it("should accept HTTPS URLs", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            file: "https://s3.amazonaws.com/bucket/file.pdf",
            mediaType: "application/pdf",
          },
        ],
      },
    ];

    expect(() => validateFilePartsInMessages(messages)).not.toThrow();
  });

  it("should validate multiple file parts", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            file: "https://s3.amazonaws.com/bucket/file1.pdf",
            mediaType: "application/pdf",
          },
          {
            type: "file",
            file: "data:image/jpeg;base64,/9j/4AAQSkZJRg==", // Invalid
            mediaType: "image/jpeg",
          },
        ],
      },
    ];

    expect(() => validateFilePartsInMessages(messages)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("Inline file data (base64/data URLs) is not allowed"),
      })
    );
  });

  it("should skip validation for non-user messages", () => {
    const messages: UIMessage[] = [
      {
        role: "assistant",
        content: "This is a response",
      },
    ];

    expect(() => validateFilePartsInMessages(messages)).not.toThrow();
  });

  it("should skip validation for string content", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: "This is plain text",
      },
    ];

    expect(() => validateFilePartsInMessages(messages)).not.toThrow();
  });
});
