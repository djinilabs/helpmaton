import { getDefined } from "../utils";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Validate Cloudflare Turnstile CAPTCHA token
 * @param token - CAPTCHA token from client
 * @param ip - User's IP address
 * @returns true if token is valid, false otherwise
 */
export async function validateCloudflareTurnstile(
  token: string,
  ip: string
): Promise<boolean> {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    return false;
  }

  const secretKey = getDefined(
    process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
    "CLOUDFLARE_TURNSTILE_SECRET_KEY is required"
  );

  try {
    // Cloudflare Turnstile expects application/x-www-form-urlencoded format
    const formData = new URLSearchParams({
      secret: secretKey,
      response: token,
      remoteip: ip,
    });

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      console.error(
        "[validateCloudflareTurnstile] Turnstile API error:",
        response.status,
        response.statusText
      );
      return false;
    }

    const data = (await response.json()) as {
      success: boolean;
      "error-codes"?: string[];
      challenge_ts?: string;
      hostname?: string;
    };

    if (!data.success) {
      console.warn(
        "[validateCloudflareTurnstile] Turnstile validation failed:",
        data["error-codes"]
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      "[validateCloudflareTurnstile] Error validating token:",
      error
    );
    return false;
  }
}

