import type { UserModelMessage } from "ai";
import { describe, it, expect } from "vitest";

import type { UIMessage } from "../../../utils/messageTypes";
import { convertUIMessagesToModelMessages } from "../messageConversion";

describe("convertUIMessagesToModelMessages - File Parts", () => {
  it("should convert file content to FilePart for non-image files", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Please analyze this document" },
          {
            type: "file",
            file: "https://s3.amazonaws.com/bucket/file.pdf",
            mediaType: "application/pdf",
          },
        ],
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);

    expect(result).toHaveLength(1);
    const userMessage = result[0] as UserModelMessage;
    expect(userMessage.role).toBe("user");
    expect(Array.isArray(userMessage.content)).toBe(true);

    const content = userMessage.content as Array<unknown>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "Please analyze this document" });
    expect(content[1]).toMatchObject({
      type: "file",
      data: "https://s3.amazonaws.com/bucket/file.pdf",
    });
  });

  it("should convert file content to ImagePart for image files", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "What's in this image?" },
          {
            type: "file",
            file: "https://s3.amazonaws.com/bucket/image.jpg",
            mediaType: "image/jpeg",
          },
        ],
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);

    expect(result).toHaveLength(1);
    const userMessage = result[0] as UserModelMessage;
    expect(userMessage.role).toBe("user");
    expect(Array.isArray(userMessage.content)).toBe(true);

    const content = userMessage.content as Array<unknown>;
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "What's in this image?" });
    expect(content[1]).toMatchObject({
      type: "image",
      image: "https://s3.amazonaws.com/bucket/image.jpg",
    });
  });

  it("should detect image files by URL extension", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "file",
            file: "https://s3.amazonaws.com/bucket/photo.png",
            // No mediaType provided
          },
        ],
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);

    const userMessage = result[0] as UserModelMessage;
    const content = userMessage.content as Array<unknown>;
    expect(content[0]).toMatchObject({
      type: "image",
      image: "https://s3.amazonaws.com/bucket/photo.png",
    });
  });

  it("should reject base64/data URLs", () => {
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

    expect(() => convertUIMessagesToModelMessages(messages)).toThrow(
      "Inline file data (base64/data URLs) is not allowed"
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

    expect(() => convertUIMessagesToModelMessages(messages)).toThrow(
      "Inline file data (base64/data URLs) is not allowed"
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

    expect(() => convertUIMessagesToModelMessages(messages)).toThrow(
      "File URL must be a valid HTTP/HTTPS URL"
    );
  });

  it("should handle multiple file parts", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze these files" },
          {
            type: "file",
            file: "https://s3.amazonaws.com/bucket/doc1.pdf",
            mediaType: "application/pdf",
          },
          {
            type: "file",
            file: "https://s3.amazonaws.com/bucket/image.jpg",
            mediaType: "image/jpeg",
          },
        ],
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);

    const userMessage = result[0] as UserModelMessage;
    const content = userMessage.content as Array<unknown>;
    expect(content).toHaveLength(3);
    
    // First part should be text
    expect(content[0]).toMatchObject({ type: "text", text: "Analyze these files" });
    
    // Check that we have both a FilePart (PDF) and an ImagePart (JPG)
    // The order may vary (text, then images, then files)
    const fileParts = content.filter((part: unknown) => 
      typeof part === "object" && part !== null && "type" in part && part.type === "file"
    );
    const imageParts = content.filter((part: unknown) => 
      typeof part === "object" && part !== null && "type" in part && part.type === "image"
    );
    
    expect(fileParts.length).toBe(1); // Should have exactly one FilePart (PDF)
    expect(imageParts.length).toBe(1); // Should have exactly one ImagePart (JPG)
    
    // Verify the URLs are correct
    const pdfPart = fileParts[0] as { type: "file"; data: string };
    const imagePart = imageParts[0] as { type: "image"; image: string };
    expect(pdfPart.data).toBe("https://s3.amazonaws.com/bucket/doc1.pdf");
    expect(imagePart.image).toBe("https://s3.amazonaws.com/bucket/image.jpg");
  });

  it("should handle text-only message without files", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: "Hello, how are you?",
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);

    expect(result).toHaveLength(1);
    const userMessage = result[0] as UserModelMessage;
    expect(userMessage.role).toBe("user");
    expect(userMessage.content).toBe("Hello, how are you?");
  });

  it("should handle text with file in array format", () => {
    const messages: UIMessage[] = [
      {
        role: "user",
        content: [
          "Please review",
          {
            type: "file",
            file: "https://s3.amazonaws.com/bucket/file.txt",
            mediaType: "text/plain",
          },
        ],
      },
    ];

    const result = convertUIMessagesToModelMessages(messages);

    const userMessage = result[0] as UserModelMessage;
    const content = userMessage.content as Array<unknown>;
    // String content is converted to TextPart
    expect(content[0]).toMatchObject({ type: "text", text: "Please review" });
    expect(content[1]).toMatchObject({ type: "file" });
  });
});
