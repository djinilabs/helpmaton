import { describe, expect, it } from "vitest";
import { z } from "zod";

import { validateToolArgs } from "../toolValidation";

describe("validateToolArgs", () => {
  it("repairs top-level and nested keys", () => {
    const schema = z
      .object({
        userId: z.string(),
        profile: z
          .object({
            firstName: z.string(),
            tags: z.array(
              z
                .object({
                  tagId: z.string(),
                })
                .strict()
            ),
          })
          .strict(),
      })
      .strict();

    const parsed = validateToolArgs(schema, {
      user_id: "user-1",
      Profile: {
        first_name: "Ada",
        tags: [{ tag_id: "tag-1" }],
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toEqual({
        userId: "user-1",
        profile: {
          firstName: "Ada",
          tags: [{ tagId: "tag-1" }],
        },
      });
    }
  });

  it("keeps canonical keys when duplicates are present", () => {
    const schema = z
      .object({
        userId: z.string(),
      })
      .strict();

    const parsed = validateToolArgs(schema, {
      userId: "correct",
      user_id: "ignored",
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toEqual({ userId: "correct" });
    }
  });

  it("preserves unknown keys for strict errors", () => {
    const schema = z
      .object({
        userId: z.string(),
      })
      .strict();

    const parsed = validateToolArgs(schema, {
      userId: "user-1",
      mystery: "nope",
    });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain("Unknown field");
      expect(parsed.error).toContain("mystery");
    }
  });

  it("repairs union object keys", () => {
    const schema = z.union([
      z
        .object({
          userId: z.string(),
        })
        .strict(),
      z
        .object({
          accountId: z.string(),
        })
        .strict(),
    ]);

    const parsed = validateToolArgs(schema, {
      user_id: "user-1",
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toEqual({ userId: "user-1" });
    }
  });

  it("repairs record value keys", () => {
    const schema = z
      .object({
        metadata: z.record(
          z.string(),
          z
            .object({
              itemId: z.string(),
            })
            .strict()
        ),
      })
      .strict();

    const parsed = validateToolArgs(schema, {
      metadata: {
        first_item: {
          item_id: "item-1",
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data).toEqual({
        metadata: {
          first_item: {
            itemId: "item-1",
          },
        },
      });
    }
  });
});
