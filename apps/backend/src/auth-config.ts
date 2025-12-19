import { ExpressAuthConfig } from "@auth/express";

import { getDefined, once } from "./utils";
import { getDynamoDBAdapter } from "./utils/authUtils";
import { Sentry, ensureError, flushSentry, initSentry } from "./utils/sentry";
import { getUserSubscription, getUserByEmail } from "./utils/subscriptionUtils";

// Initialize Sentry when this module is loaded
initSentry();

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
          // This is critical - every user must have a subscription for API Gateway throttling
          let userId: string | undefined = user.id;
          let subscriptionCreated = false;
          const maxRetries = 3;
          const retryDelay = 500; // 500ms

          // Try to get userId with retries (user.id might not be set immediately)
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (userId) {
              break;
            }

            if (user.email) {
              try {
                const userRecord = await getUserByEmail(user.email);
                if (userRecord?.userId) {
                  userId = userRecord.userId;
                  break;
                }
              } catch (error) {
                console.warn(
                  `[signIn] Attempt ${attempt}/${maxRetries}: Failed to lookup user by email:`,
                  error instanceof Error ? error.message : String(error)
                );
              }
            }

            // Wait before retrying (except on last attempt)
            if (attempt < maxRetries) {
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
            }
          }

          // If we still don't have userId, this is a critical error
          if (!userId) {
            const errorContext = {
              user: {
                id: user.id,
                email: user.email,
                name: user.name,
              },
              account: {
                type: account?.type,
                provider: account?.provider,
              },
            };

            console.error(
              `[signIn] CRITICAL: Could not determine userId for user with email ${user.email}. User may be created without subscription!`,
              errorContext
            );

            // Report to Sentry with full context
            Sentry.captureException(
              new Error(
                `Failed to determine userId during sign-in for user with email: ${user.email}`
              ),
              {
                tags: {
                  handler: "NextAuth.signIn",
                  errorType: "userId_lookup_failed",
                  authType: "email",
                },
                contexts: {
                  user: errorContext.user,
                  account: errorContext.account,
                },
                extra: errorContext,
                level: "error",
              }
            );

            return true;
          }

          // Create subscription with retries
          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              // This will create a free subscription if one doesn't exist
              await getUserSubscription(userId);
              subscriptionCreated = true;
              console.log(
                `[signIn] Successfully ensured subscription exists for user ${userId} (attempt ${attempt})`
              );
              break;
            } catch (error) {
              const isLastAttempt = attempt === maxRetries;
              const errorMessage =
                error instanceof Error ? error.message : String(error);

              if (isLastAttempt) {
                // Critical error - log prominently but don't block login
                // Subscription will be auto-created on first API call via getUserSubscription
                const errorDetails = {
                  userId,
                  email: user.email,
                  error: errorMessage,
                  stack: error instanceof Error ? error.stack : undefined,
                  attempts: maxRetries,
                };

                console.error(
                  `[signIn] CRITICAL: Failed to create subscription for user ${userId} after ${maxRetries} attempts. User may proceed without subscription initially.`,
                  errorDetails
                );

                // Report to Sentry with full context
                Sentry.captureException(ensureError(error), {
                  tags: {
                    handler: "NextAuth.signIn",
                    errorType: "subscription_creation_failed",
                    authType: "email",
                    userId,
                  },
                  contexts: {
                    user: {
                      id: userId,
                      email: user.email,
                    },
                    subscription: {
                      attempts: maxRetries,
                      retryDelay: retryDelay,
                    },
                  },
                  extra: errorDetails,
                  level: "error",
                });

                // Flush Sentry events (fire-and-forget)
                flushSentry().catch((flushError) => {
                  console.error("[Sentry] Error flushing events:", flushError);
                });
              } else {
                console.warn(
                  `[signIn] Attempt ${attempt}/${maxRetries}: Failed to create subscription for user ${userId}, retrying...`,
                  errorMessage
                );
                // Wait before retrying
                await new Promise((resolve) => setTimeout(resolve, retryDelay));
              }
            }
          }

          if (!subscriptionCreated) {
            // Log as critical issue - this should be monitored
            const errorMessage = `Subscription creation failed for user ${userId} after all retry attempts. Subscription will be auto-created on first API call, but user may experience issues until then.`;

            console.error(`[signIn] CRITICAL: ${errorMessage}`);

            // Report to Sentry (this is a fallback - the actual error should have been reported above)
            Sentry.captureException(new Error(errorMessage), {
              tags: {
                handler: "NextAuth.signIn",
                errorType: "subscription_creation_failed_final",
                authType: "email",
                userId,
              },
              contexts: {
                user: {
                  id: userId,
                  email: user.email,
                },
              },
              extra: {
                userId,
                email: user.email,
                maxRetries,
              },
              level: "error",
            });

            // Flush Sentry events (fire-and-forget)
            flushSentry().catch((flushError) => {
              console.error("[Sentry] Error flushing events:", flushError);
            });
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
