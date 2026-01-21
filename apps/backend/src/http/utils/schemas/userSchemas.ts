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

export const authGateVerificationSchema = z
  .object({
    captchaToken: z.string().min(1, "captchaToken is required"),
    acceptedTerms: z
      .boolean()
      .refine((value) => value === true, {
        message: "Terms of service must be accepted",
      }),
    callbackUrl: z
      .string()
      .min(1, "callbackUrl is required")
      .transform((value) => value.trim()),
  })
  .strict();
