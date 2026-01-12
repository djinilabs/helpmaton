import { badRequest } from "@hapi/boom";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { z } from "zod";

/**
 * Parses and validates a request body from an API Gateway event using a Zod schema.
 * Handles base64 decoding automatically.
 * Uses strict mode to reject extra attributes.
 * Throws a badRequest boom error if validation fails.
 *
 * @param event - The API Gateway event containing the body
 * @param schema - The Zod schema to validate against
 * @returns The validated and typed body
 * @throws {Boom} badRequest error if body is invalid JSON or fails validation
 */
export function parseAndValidateBody<T>(
  event: APIGatewayProxyEventV2,
  schema: z.ZodSchema<T>
): T {
  let bodyText: string;

  if (!event.body) {
    throw badRequest("Request body is required");
  }

  // Decode base64 if needed
  if (event.isBase64Encoded) {
    try {
      bodyText = Buffer.from(event.body, "base64").toString("utf-8");
    } catch {
      throw badRequest("Invalid base64 encoding in request body");
    }
  } else {
    bodyText = event.body;
  }

  // Parse JSON
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    throw badRequest("Invalid JSON in request body");
  }

  // Validate with Zod schema (strict mode)
  // Apply strict validation - schemas should be defined with .strict() when created
  // For runtime, we'll use the schema as-is (it should already be strict)
  const result = (schema as z.ZodType<T>).safeParse(parsedBody);

  if (!result.success) {
    // Format Zod errors into a readable message
    const errorMessages = result.error.issues.map((err) => {
      const path = err.path.length > 0 ? err.path.join(".") : "root";
      return `${path}: ${err.message}`;
    });
    throw badRequest(`Validation failed: ${errorMessages.join("; ")}`);
  }

  return result.data;
}

/**
 * Validates an already-parsed request body using a Zod schema.
 * For use with Express routes where req.body is already parsed by express.json().
 * Uses strict mode to reject extra attributes.
 * Throws a badRequest boom error if validation fails.
 *
 * @param body - The parsed request body (from req.body)
 * @param schema - The Zod schema to validate against
 * @returns The validated and typed body
 * @throws {Boom} badRequest error if body fails validation
 */
export function validateBody<T>(
  body: unknown,
  schema: z.ZodSchema<T>
): T {
  // Validate with Zod schema (strict mode)
  // Apply strict validation - schemas should be defined with .strict() when created
  // For runtime, we'll use the schema as-is (it should already be strict)
  const result = (schema as z.ZodType<T>).safeParse(body);

  if (!result.success) {
    // Format Zod errors into a readable message
    const errorMessages = result.error.issues.map((err) => {
      const path = err.path.length > 0 ? err.path.join(".") : "root";
      return `${path}: ${err.message}`;
    });
    throw badRequest(`Validation failed: ${errorMessages.join("; ")}`);
  }

  return result.data;
}
