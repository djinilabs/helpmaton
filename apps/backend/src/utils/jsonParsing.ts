function extractFirstJsonObject(value: string): string | null {
  const startIndex = value.indexOf("{");
  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = startIndex; i < value.length; i += 1) {
    const char = value[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

export function stripJsonCodeFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```json")) {
    return trimmed.replace(/^```json\s*/, "").replace(/\s*```$/, "");
  }
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return trimmed;
}

export function parseJsonWithFallback<T>(text: string): T {
  const cleaned = stripJsonCodeFences(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    const extracted = extractFirstJsonObject(cleaned);
    if (!extracted) {
      throw error;
    }
    return JSON.parse(extracted) as T;
  }
}
