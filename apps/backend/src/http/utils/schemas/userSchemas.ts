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

/**
 * Passkey registration verify body (RegistrationResponseJSON from browser).
 * Browser/SimpleWebAuthn may include extra fields (transports, publicKey, etc.); allow them so validation passes.
 */
const passkeyAttestationResponseSchema = z
  .object({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1),
    transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
    authenticatorData: z.string().optional(),
  })
  .strict();

export const passkeyRegisterVerifySchema = z
  .object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    response: passkeyAttestationResponseSchema,
    clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
    type: z.literal("public-key"),
    authenticatorAttachment: z.string().optional(),
  })
  .strict();

/**
 * Passkey login verify body (AuthenticationResponseJSON from browser).
 */
const passkeyAssertionResponseSchema = z
  .object({
    clientDataJSON: z.string().min(1),
    authenticatorData: z.string().min(1),
    signature: z.string().min(1),
    userHandle: z.string().optional(),
  })
  .strict();

export const passkeyLoginVerifySchema = z
  .object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    response: passkeyAssertionResponseSchema,
    clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
    type: z.literal("public-key"),
    authenticatorAttachment: z.string().optional(),
  })
  .strict();
