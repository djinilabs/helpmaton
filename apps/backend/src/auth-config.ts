import { ExpressAuthConfig } from "@auth/express";

import { getDefined, once } from "./utils";
import { getDynamoDBAdapter } from "./utils/authUtils";
import { getUserSubscription, getUserByEmail } from "./utils/subscriptionUtils";

// Function to check if user is allowed to sign in
async function isUserAllowedToSignIn(email: string): Promise<boolean> {
  if (!email) return false;

  const normalizedEmail = email.toLowerCase();

  // Always allow specific email addresses
  const alwaysAllowedEmails = ["i@pgte.me", "pedro.teixeira@gmail.com"];
  if (alwaysAllowedEmails.includes(normalizedEmail)) {
    return true;
  }

  // Allow testmail emails for testing
  const emailDomain = normalizedEmail.split("@")[1];
  if (emailDomain && emailDomain.endsWith("inbox.testmail.app")) {
    return true;
  }

  // Check if there's a whitelist in environment variable
  const allowedEmails =
    process.env.ALLOWED_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) ||
    [];
  if (allowedEmails.includes(normalizedEmail)) {
    return true;
  }

  // If no whitelist is configured, deny all emails
  return false;
}

export const authConfig = once(async (): Promise<ExpressAuthConfig> => {
  // Get the DynamoDB adapter using the shared utility
  const databaseAdapter = await getDynamoDBAdapter();

  // Custom email provider
  const customEmailProvider = {
    id: "email",
    type: "email" as const,
    name: "Email",
    from: `info@${process.env.MAILGUN_DOMAIN || "helpmaton.com"}`,
    maxAge: 24 * 60 * 60,
    async sendVerificationRequest(req: {
      identifier: string;
      url: string;
      theme: { brandColor?: string; buttonText?: string };
    }) {
      const { identifier: to, url } = req;

      try {
        // Replace backend URL with frontend URL for login links
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

        // Validate and parse URLs
        let urlObj: URL;
        let frontendUrlObj: URL;

        try {
          urlObj = new URL(url);
        } catch (error) {
          console.error("Invalid callback URL from NextAuth:", url, error);
          throw new Error(`Invalid callback URL: ${url}`);
        }

        try {
          frontendUrlObj = new URL(frontendUrl);
        } catch (error) {
          console.error("Invalid FRONTEND_URL:", frontendUrl, error);
          throw new Error(`Invalid FRONTEND_URL: ${frontendUrl}`);
        }

        // Replace the origin (protocol + host + port) with the frontend URL
        urlObj.protocol = frontendUrlObj.protocol;
        urlObj.host = frontendUrlObj.host;

        const frontendLoginUrl = urlObj.toString();
        let host: string;

        try {
          const parsedUrl = new URL(frontendLoginUrl);
          host = parsedUrl.host;
        } catch (error) {
          console.error(
            "Failed to parse frontend login URL:",
            frontendLoginUrl,
            error
          );
          throw new Error(
            `Failed to parse frontend login URL: ${frontendLoginUrl}`
          );
        }

        const { sendEmail } = await import("./send-email");

        await sendEmail({
          to,
          subject: `Sign in to ${host}`,
          text: `Sign in to ${host}\n\n${frontendLoginUrl}\n\nIf you did not request this email, you can safely ignore it.`,
        });

        console.log(`Magic link email sent successfully to ${to}`);
      } catch (error) {
        console.error("Failed to send verification email:", {
          to,
          url,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Re-throw the error so NextAuth can handle it appropriately
        throw error;
      }
    },
    normalizeIdentifier: (identifier: string) => identifier.toLowerCase(),
  };

  // Get frontend URL for redirects
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  return {
    debug: process.env.NODE_ENV === "development",
    secret: getDefined(process.env.AUTH_SECRET, "AUTH_SECRET is required"),
    basePath: "/api/auth",
    trustHost: true, // Trust forwarded headers from proxy
    session: {
      strategy: "jwt",
      maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
    },
    theme: {
      colorScheme: "light",
      brandColor: "#008080",
      buttonText: "Sign in",
    },
    providers: [customEmailProvider],
    adapter: databaseAdapter,
    callbacks: {
      async signIn({ user, account }) {
        // Check if user is allowed to sign in
        const isEmailAllowed = await isUserAllowedToSignIn(user.email ?? "");
        if (!isEmailAllowed) {
          console.log("Email not allowed to sign in:", user.email);
          return false;
        }

        // For email authentication
        if (account?.type === "email") {
          // Ensure user has a subscription (create free subscription if needed)
          try {
            // Get userId - use user.id if available, otherwise look up by email
            let userId: string | undefined = user.id;

            if (!userId && user.email) {
              const userRecord = await getUserByEmail(user.email);
              userId = userRecord?.userId;
            }

            if (userId) {
              // This will create a free subscription if one doesn't exist
              await getUserSubscription(userId);
              console.log(
                `[signIn] Ensured subscription exists for user ${userId}`
              );
            } else {
              console.warn(
                `[signIn] Could not determine userId for user with email ${user.email}`
              );
            }
          } catch (error) {
            // Log error but don't block login
            console.error(
              `[signIn] Failed to ensure subscription for user ${user.email}:`,
              error instanceof Error ? error.message : String(error)
            );
          }

          return true;
        }

        console.log("Unknown authentication method:", account);
        return false;
      },
      async jwt({ token, account, user }) {
        // Handle email authentication
        if (account?.type === "email" && account.providerAccountId) {
          token.email = account.providerAccountId;
          token.id = token.sub;
          if (user?.name) {
            token.name = user.name;
          }
        }

        return token;
      },
      async session({ session, token }) {
        if (token.sub) {
          session.user.id = token.sub;
        }
        if (token.email) {
          session.user.email = token.email;
        }
        if (token.name) {
          session.user.name = token.name;
        }
        return session;
      },
      async redirect({ url }) {
        // Always redirect to frontend URL, not backend
        // If the URL is relative or points to backend, redirect to frontend
        const frontendUrlObj = new URL(frontendUrl);

        try {
          const urlObj = new URL(url);
          // If URL points to backend, replace with frontend
          if (urlObj.origin !== frontendUrlObj.origin) {
            urlObj.protocol = frontendUrlObj.protocol;
            urlObj.host = frontendUrlObj.host;
            return urlObj.toString();
          }
          return url;
        } catch {
          // If URL is relative, prepend frontend URL
          if (url.startsWith("/")) {
            return `${frontendUrl}${url}`;
          }
          // If URL is already absolute and valid, use it
          return url.startsWith(frontendUrl) ? url : `${frontendUrl}${url}`;
        }
      },
    },
  };
});
