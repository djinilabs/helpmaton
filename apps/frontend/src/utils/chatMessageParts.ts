export function lastAssistantMessageHasText(
  messages: Array<{
    role?: string;
    parts?: unknown[];
    content?: unknown;
  }>,
): boolean {
  if (messages.length === 0) {
    return false;
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "assistant") {
    return false;
  }

  const normalizePart = (part: unknown): unknown => {
    if (typeof part === "string") {
      return { type: "text", text: part };
    }
    if (typeof part === "object" && part !== null) {
      if ("type" in part && typeof part.type === "string") {
        return part;
      }
      if ("text" in part && typeof part.text === "string") {
        return { type: "text", text: part.text };
      }
    }
    return part;
  };

  let parts: unknown[] = [];
  if (Array.isArray(lastMessage.parts)) {
    parts = lastMessage.parts
      .filter((part) => part !== null && part !== undefined)
      .map(normalizePart);
  } else if ("content" in lastMessage) {
    const content = lastMessage.content;
    if (typeof content === "string") {
      parts = content.trim() ? [{ type: "text", text: content }] : [];
    } else if (Array.isArray(content)) {
      parts = content.map(normalizePart);
    }
  }

  return parts.some((part) => {
    if (!part) {
      return false;
    }
    if (typeof part === "string") {
      return part.trim().length > 0;
    }
    if (
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      return part.text.trim().length > 0;
    }
    return false;
  });
}
