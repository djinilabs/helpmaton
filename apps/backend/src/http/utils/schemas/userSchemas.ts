import { z } from "zod";

/**
 * User API key schemas
 */

export const createUserApiKeySchema = z.object({
  name: z.string().optional(),
}).strict();

/**
 * Token schemas
 */

// Generate tokens doesn't require a body, but we'll create an empty schema for consistency
export const generateTokensSchema = z.object({}).strict();

export const refreshTokenSchema = z.object({
  refreshToken: z
    .string()
    .min(1, "refreshToken is required")
    .refine(
      (val) => {
        const trimmed = val.trim();
        return (
          trimmed.startsWith("hmat_refresh_") &&
          trimmed.length >= 70 &&
          trimmed.length <= 80
        );
      },
      { message: "Invalid refresh token format" }
    ),
}).strict();
