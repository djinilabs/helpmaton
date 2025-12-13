import { createHash, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

import { unauthorized } from "@hapi/boom";
import { SignJWT, jwtVerify } from "jose";

function getDefined<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

// Reuse scrypt configuration from apiKeyUtils
const scryptAsync = promisify(
  (
    password: string | Buffer,
    salt: string | Buffer,
    keylen: number,
    options: { N: number; r: number; p: number },
    callback: (err: Error | null, derivedKey: Buffer) => void
  ) => {
    scrypt(password, salt, keylen, options, callback);
  }
) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>;

const REFRESH_TOKEN_PREFIX = "hmat_refresh_";
const REFRESH_TOKEN_LENGTH = 32; // 32 bytes = 64 hex characters after prefix
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16384, // CPU/memory cost parameter
  r: 8, // Block size parameter
  p: 1, // Parallelization parameter
};

const ACCESS_TOKEN_EXPIRY = 60 * 60; // 1 hour in seconds

/**
 * Get the JWT secret key from environment
 * @returns Secret key as Uint8Array for jose
 */
function getJwtSecret(): Uint8Array {
  const secret = getDefined(process.env.AUTH_SECRET, "AUTH_SECRET is required");
  // Convert string secret to Uint8Array (jose requires Uint8Array)
  return new TextEncoder().encode(secret);
}

/**
 * Generate a JWT access token
 * @param userId - User ID
 * @param email - User email
 * @returns JWT access token string
 */
export async function generateAccessToken(
  userId: string,
  email: string
): Promise<string> {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    userId,
    email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_EXPIRY)
    .setIssuer("helpmaton")
    .setAudience("helpmaton-api")
    .sign(secret);

  return token;
}

/**
 * Verify and decode a JWT access token
 * @param token - JWT token string
 * @returns Decoded token payload with userId and email
 * @throws unauthorized error if token is invalid, expired, or malformed
 */
export async function verifyAccessToken(
  token: string
): Promise<{ userId: string; email: string }> {
  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret, {
      issuer: "helpmaton",
      audience: "helpmaton-api",
    });

    if (
      typeof payload.userId === "string" &&
      typeof payload.email === "string"
    ) {
      return {
        userId: payload.userId,
        email: payload.email,
      };
    }

    // Invalid payload structure
    throw unauthorized("Invalid access token: missing required claims");
  } catch (error) {
    // If it's already a boom error, re-throw it
    if (error && typeof error === "object" && "isBoom" in error) {
      throw error;
    }

    // JWT verification errors (expired, invalid signature, etc.)
    console.error("[tokenUtils] Error verifying access token:", error);
    throw unauthorized("Invalid or expired access token");
  }
}

/**
 * Generate a new refresh token
 * Format: hmat_refresh_<64 hex characters>
 * @returns Generated refresh token string
 */
export function generateRefreshToken(): string {
  const randomPart = randomBytes(REFRESH_TOKEN_LENGTH).toString("hex");
  const token = `${REFRESH_TOKEN_PREFIX}${randomPart}`;

  // Validate generated token length (should be 78: 14 prefix + 64 hex chars)
  const expectedLength = REFRESH_TOKEN_PREFIX.length + REFRESH_TOKEN_LENGTH * 2;
  if (token.length !== expectedLength) {
    // This should never happen, but log it if it does
    console.error("[tokenUtils] Generated token has unexpected length:", {
      tokenLength: token.length,
      expectedLength,
      prefixLength: REFRESH_TOKEN_PREFIX.length,
      randomPartLength: randomPart.length,
      expectedRandomPartLength: REFRESH_TOKEN_LENGTH * 2,
    });
    // Still return the token - the validation endpoint will handle invalid tokens
  }

  return token;
}

/**
 * Generate a deterministic lookup hash for a refresh token
 * This is used for GSI queries - it's a simple SHA256 hash for fast lookup
 * @param token - The refresh token
 * @returns SHA256 hash as hex string
 */
export function generateTokenLookupHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Hash a refresh token using scrypt
 * @param token - The refresh token to hash
 * @returns Object containing the hash, salt, and lookup hash
 */
export async function hashRefreshToken(
  token: string
): Promise<{ hash: string; salt: string; lookupHash: string }> {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const hash = (await scryptAsync(
    token,
    salt,
    SCRYPT_KEY_LENGTH,
    SCRYPT_OPTIONS
  )) as Buffer;

  // Generate deterministic lookup hash for GSI queries
  const lookupHash = generateTokenLookupHash(token);

  return {
    hash: hash.toString("base64"),
    salt: salt.toString("base64"),
    lookupHash,
  };
}

/**
 * Validate a refresh token against a stored hash
 * @param token - The refresh token to validate
 * @param storedHash - The stored hash (base64 encoded)
 * @param salt - The salt used for hashing (base64 encoded)
 * @returns True if the token matches the hash
 */
export async function validateRefreshToken(
  token: string,
  storedHash: string,
  salt: string
): Promise<boolean> {
  try {
    const saltBuffer = Buffer.from(salt, "base64");
    const storedHashBuffer = Buffer.from(storedHash, "base64");

    const computedHash = (await scryptAsync(
      token,
      saltBuffer,
      SCRYPT_KEY_LENGTH,
      SCRYPT_OPTIONS
    )) as Buffer;

    // Use timing-safe comparison to prevent timing attacks
    if (computedHash.length !== storedHashBuffer.length) {
      return false;
    }

    return timingSafeEqual(computedHash, storedHashBuffer);
  } catch (error) {
    console.error("[tokenUtils] Error validating refresh token:", error);
    return false;
  }
}
