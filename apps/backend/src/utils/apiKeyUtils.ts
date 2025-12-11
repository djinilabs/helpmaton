import { createHash, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";

// scrypt with options signature: (password, salt, keylen, options, callback)
// When promisified, it becomes: (password, salt, keylen, options)
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

const API_KEY_PREFIX = "hmat_";
const API_KEY_LENGTH = 32; // 32 bytes = 64 hex characters after prefix
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = {
  N: 16384, // CPU/memory cost parameter
  r: 8, // Block size parameter
  p: 1, // Parallelization parameter
};

/**
 * Generate a new API key with prefix
 * Format: hmat_<64 hex characters>
 * @returns Generated API key string
 */
export function generateApiKey(): string {
  const randomPart = randomBytes(API_KEY_LENGTH).toString("hex");
  return `${API_KEY_PREFIX}${randomPart}`;
}

/**
 * Generate a deterministic lookup hash for an API key
 * This is used for GSI queries - it's a simple SHA256 hash for fast lookup
 * @param key - The API key
 * @returns SHA256 hash as hex string
 */
export function generateKeyLookupHash(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Hash an API key using scrypt
 * @param key - The API key to hash
 * @returns Object containing the hash, salt, and lookup hash
 */
export async function hashApiKey(
  key: string
): Promise<{ hash: string; salt: string; lookupHash: string }> {
  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const hash = (await scryptAsync(
    key,
    salt,
    SCRYPT_KEY_LENGTH,
    SCRYPT_OPTIONS
  )) as Buffer;

  // Generate deterministic lookup hash for GSI queries
  const lookupHash = generateKeyLookupHash(key);

  return {
    hash: hash.toString("base64"),
    salt: salt.toString("base64"),
    lookupHash,
  };
}

/**
 * Validate an API key against a stored hash
 * @param key - The API key to validate
 * @param storedHash - The stored hash (base64 encoded)
 * @param salt - The salt used for hashing (base64 encoded)
 * @returns True if the key matches the hash
 */
export async function validateApiKey(
  key: string,
  storedHash: string,
  salt: string
): Promise<boolean> {
  try {
    const saltBuffer = Buffer.from(salt, "base64");
    const storedHashBuffer = Buffer.from(storedHash, "base64");

    const computedHash = (await scryptAsync(
      key,
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
    console.error("[apiKeyUtils] Error validating API key:", error);
    return false;
  }
}

/**
 * Extract the prefix from an API key for display
 * @param key - The full API key
 * @returns The prefix (first 12 characters including "hmat_")
 */
export function getKeyPrefix(key: string): string {
  if (key.length <= 12) {
    return key;
  }
  return key.substring(0, 12);
}

/**
 * Mask an API key for display
 * @param key - The full API key
 * @returns Masked version showing only prefix and last 4 characters
 */
export function maskApiKey(key: string): string {
  if (key.length <= 16) {
    return "****";
  }
  const prefix = getKeyPrefix(key);
  const last4 = key.substring(key.length - 4);
  return `${prefix}...${last4}`;
}
