import { describe, expect, it } from "vitest";

import { validateMcpToolParams } from "../mcpToolSchemaValidation";

describe("validateMcpToolParams", () => {
  it("repairs top-level and nested keys", () => {
    const schema = {
      type: "object",
      properties: {
        userId: { type: "string" },
        details: {
          type: "object",
          properties: {
            firstName: { type: "string" },
            lastName: { type: "string" },
          },
          required: ["firstName"],
          additionalProperties: false,
        },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              itemId: { type: "string" },
            },
            required: ["itemId"],
            additionalProperties: false,
          },
        },
      },
      required: ["userId", "details", "items"],
      additionalProperties: false,
    };

    const result = validateMcpToolParams(schema, {
      user_id: "user-1",
      Details: {
        first_name: "Ada",
        last_name: "Lovelace",
      },
      items: [{ item_id: "item-1" }],
    });

    expect(result.ok).toBe(true);
  });

  it("keeps canonical keys when duplicates are present", () => {
    const schema = {
      type: "object",
      properties: {
        userId: { type: "string" },
      },
      required: ["userId"],
      additionalProperties: false,
    };

    const result = validateMcpToolParams(schema, {
      userId: "correct",
      user_id: "ignored",
    });

    expect(result.ok).toBe(true);
  });

  it("preserves unknown keys for strict errors", () => {
    const schema = {
      type: "object",
      properties: {
        userId: { type: "string" },
      },
      required: ["userId"],
      additionalProperties: false,
    };

    const result = validateMcpToolParams(schema, {
      userId: "user-1",
      mystery: "nope",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unknown field");
      expect(result.error).toContain("mystery");
    }
  });

  it("repairs union object keys", () => {
    const schema = {
      oneOf: [
        {
          type: "object",
          properties: {
            userId: { type: "string" },
          },
          required: ["userId"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            accountId: { type: "string" },
          },
          required: ["accountId"],
          additionalProperties: false,
        },
      ],
    };

    const result = validateMcpToolParams(schema, {
      user_id: "user-1",
    });

    expect(result.ok).toBe(true);
  });

  it("repairs record value keys", () => {
    const schema = {
      type: "object",
      properties: {
        metadata: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              itemId: { type: "string" },
            },
            required: ["itemId"],
            additionalProperties: false,
          },
        },
      },
      required: ["metadata"],
      additionalProperties: false,
    };

    const result = validateMcpToolParams(schema, {
      metadata: {
        first_item: { item_id: "item-1" },
      },
    });

    expect(result.ok).toBe(true);
  });
});
