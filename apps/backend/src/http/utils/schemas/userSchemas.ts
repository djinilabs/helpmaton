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

export const refreshTokenSchema = z.object({
  refreshToken: z
    .string()
    .min(1, "refreshToken is required")
    .transform((val) => val.trim())
    .refine(
      (val) =>
        val.startsWith("hmat_refresh_") && val.length >= 70 && val.length <= 80,
      { message: "Invalid refresh token format" }
    ),
}).strict();
