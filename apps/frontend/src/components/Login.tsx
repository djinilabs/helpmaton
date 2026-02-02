import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { signIn, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import type { FC } from "react";

import { useToast } from "../hooks/useToast";
import {
  getPasskeyLoginOptions,
  verifyPasskeyLogin,
} from "../utils/passkeyApi";

const Login: FC = () => {
  const { status } = useSession();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState<boolean | null>(
    null
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const check =
      window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.();
    if (typeof check?.then !== "function") {
      setPasskeyAvailable(false);
      return;
    }
    check
      .then((available) => setPasskeyAvailable(available === true))
      .catch(() => setPasskeyAvailable(false));
  }, []);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setIsSubmitting(true);
    try {
      const result = await signIn("email", {
        email: email.trim(),
        callbackUrl: window.location.href,
        redirect: false,
      });
      if (!result?.error) {
        setEmailSent(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !isSubmitting && email.trim()) {
      e.preventDefault();
      handleEmailSignIn(e as unknown as React.FormEvent);
    }
  };

  const handlePasskeySignIn = async () => {
    setIsPasskeyLoading(true);
    try {
      const options = await getPasskeyLoginOptions();
      const assertion = await startAuthentication({
        optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
      });
      const { token } = await verifyPasskeyLogin(
        assertion as unknown as Record<string, unknown>
      );
      const result = await signIn("passkey", {
        token,
        callbackUrl: window.location.href,
        redirect: false,
      });
      if (result?.error) {
        toast.error(result.error);
      } else if (result?.ok) {
        window.location.reload();
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Passkey sign-in failed";
      if (
        message.includes("cancel") ||
        message.toLowerCase().includes("abort") ||
        message.toLowerCase().includes("user")
      ) {
        // User cancelled or no passkey - don't show harsh error
        return;
      }
      toast.error(message);
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  if (status === "authenticated") {
    return null;
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-soft p-4 dark:bg-gradient-soft-dark">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(13,148,136,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(13,148,136,0.15),transparent_50%)]"></div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(124,58,237,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_70%_80%,rgba(124,58,237,0.15),transparent_50%)]"></div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-neutral-200 bg-white/90 p-10 shadow-large backdrop-blur-sm dark:border-neutral-700 dark:bg-neutral-900/90">
        <div className="mb-10 flex items-center gap-4">
          <div className="relative">
            <img
              src="/images/helpmaton_logo.svg"
              alt="Helmaton Logo"
              className="relative z-10 size-16"
            />
          </div>
          <h1 className="text-4xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">
            Helpmaton
          </h1>
        </div>
        <h2
          className={`mb-10 text-3xl font-bold text-neutral-900 dark:text-neutral-50 ${
            emailSent ? "text-center" : ""
          }`}
        >
          {emailSent ? "Check your inbox" : "Sign in"}
        </h2>

        {emailSent ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-7"
                aria-hidden="true"
              >
                <path d="M4 4h16v16H4z" />
                <path d="m4 7 8 5 8-5" />
                <path d="m4 20 6-6" />
                <path d="m20 20-6-6" />
              </svg>
            </div>
            <p className="text-base text-neutral-700 dark:text-neutral-200">
              We sent a Helpmaton sign-in link to{" "}
              <span className="font-semibold text-neutral-900 dark:text-neutral-50">
                {email}
              </span>
              .
            </p>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">
              If it does not arrive in a few minutes, check your spam or junk
              folder.
            </p>
          </div>
        ) : (
          <form onSubmit={handleEmailSignIn} className="space-y-6">
            <div>
              <label
                htmlFor="email"
                className="mb-2.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:placeholder:text-neutral-400 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                placeholder="your@email.com"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || !email.trim()}
              className="w-full transform rounded-xl bg-gradient-primary px-4 py-3.5 font-semibold text-white transition-all duration-200 hover:scale-[1.02] hover:shadow-colored active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
            >
              {isSubmitting ? "Sending..." : "Send sign-in link"}
            </button>

            {passkeyAvailable === true && (
              <>
                <div className="relative my-4 flex items-center">
                  <div className="flex-grow border-t border-neutral-300 dark:border-neutral-600" />
                  <span className="mx-3 text-sm text-neutral-500 dark:text-neutral-400">
                    or
                  </span>
                  <div className="flex-grow border-t border-neutral-300 dark:border-neutral-600" />
                </div>

                <button
                  type="button"
                  disabled={isPasskeyLoading}
                  onClick={handlePasskeySignIn}
                  className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-3.5 font-semibold text-neutral-700 transition-all duration-200 hover:border-neutral-400 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:border-neutral-500 dark:hover:bg-neutral-700"
                >
                  {isPasskeyLoading ? "Signing in..." : "Sign in with passkey"}
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
};

export default Login;
