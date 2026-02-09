import { useEffect, useRef, useState, type FC } from "react";
import { useSearchParams } from "react-router-dom";

import { useToast } from "../hooks/useToast";

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: string | HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
        }
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const appendGateToken = (callbackUrl: string, gateToken: string) => {
  const url = new URL(callbackUrl, window.location.origin);
  url.searchParams.set("gateToken", gateToken);
  return url.toString();
};

const getErrorMessage = async (response: Response) => {
  try {
    const data = (await response.clone().json()) as { message?: string };
    if (data?.message) {
      return data.message;
    }
  } catch {
    // ignore JSON parse failures
  }

  try {
    const text = await response.text();
    if (text) {
      return text;
    }
  } catch {
    // ignore read failures
  }

  return "Verification failed. Please try again.";
};

const mapGateErrorMessage = (error?: string | null) => {
  if (error === "missing_gate") {
    return null;
  }
  if (error === "invalid_gate") {
    return "Verification expired. Please try again.";
  }
  return null;
};

const AuthGate: FC = () => {
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    mapGateErrorMessage(searchParams.get("error"))
  );
  const captchaWidgetId = useRef<string | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement>(null);

  const callbackUrl = searchParams.get("callbackUrl") || "";
  const turnstileSiteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY;

  const resetCaptcha = () => {
    if (captchaWidgetId.current && window.turnstile) {
      window.turnstile.reset(captchaWidgetId.current);
    }
    setCaptchaToken(null);
  };

  useEffect(() => {
    if (!callbackUrl) {
      setError("Invalid sign-in link. Please request a new one.");
    }
  }, [callbackUrl]);

  useEffect(() => {
    const renderTurnstile = () => {
      if (
        !turnstileSiteKey ||
        !captchaContainerRef.current ||
        captchaWidgetId.current ||
        !window.turnstile
      ) {
        return false;
      }

      const widgetId = window.turnstile.render(captchaContainerRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => {
          setCaptchaToken(token);
        },
        "error-callback": () => {
          resetCaptcha();
        },
        "expired-callback": () => {
          resetCaptcha();
        },
      });
      captchaWidgetId.current = widgetId;
      return true;
    };

    if (!turnstileSiteKey) {
      return;
    }

    renderTurnstile();
    let attempts = 0;
    const intervalId = window.setInterval(() => {
      attempts += 1;
      if (renderTurnstile() || attempts >= 40) {
        window.clearInterval(intervalId);
      }
    }, 250);

    return () => {
      window.clearInterval(intervalId);
      if (captchaWidgetId.current && window.turnstile) {
        window.turnstile.remove(captchaWidgetId.current);
        captchaWidgetId.current = null;
      }
      setCaptchaToken(null);
    };
  }, [turnstileSiteKey]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!turnstileSiteKey || !captchaToken || !callbackUrl || !acceptedTerms) {
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/user/verify-gate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          captchaToken,
          acceptedTerms,
          callbackUrl,
        }),
      });

      if (!response.ok) {
        const message = await getErrorMessage(response);
        setError(message);
        resetCaptcha();
        return;
      }

      const data = (await response.json()) as { gateToken?: string };
      if (!data.gateToken) {
        setError("Verification failed. Please try again.");
        resetCaptcha();
        return;
      }

      const redirectUrl = appendGateToken(callbackUrl, data.gateToken);
      window.location.href = redirectUrl;
    } catch {
      toast.error("Verification failed. Please check your connection.");
      resetCaptcha();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-page relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(13,148,136,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_30%_20%,rgba(13,148,136,0.15),transparent_50%)]"></div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(124,58,237,0.08),transparent_50%)] dark:bg-[radial-gradient(circle_at_70%_80%,rgba(124,58,237,0.15),transparent_50%)]"></div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-neutral-200 bg-white/90 p-10 shadow-large backdrop-blur-sm dark:border-neutral-700 dark:bg-surface-50/90">
        <h1 className="mb-3 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          Verify to continue
        </h1>
        <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">
          Confirm you accept the terms of service.
        </p>

        {error && (
          <div className="mb-6 rounded-xl border border-error-300 bg-error-100 p-3 text-sm text-error-900 dark:border-error-600 dark:bg-error-900 dark:text-error-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <div ref={captchaContainerRef} className="flex justify-center"></div>
          </div>

          <label className="flex items-start gap-3 text-sm text-neutral-700 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(event) => setAcceptedTerms(event.target.checked)}
              className="mt-1 size-4 rounded border-neutral-300 text-blue-600 focus:ring-blue-500"
            />
            <span>
              I have read and accept the{" "}
              <a
                href="/terms-of-service"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-primary-600 hover:text-primary-700"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-primary-600 hover:text-primary-700"
              >
                Privacy Policy
              </a>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={
              submitting ||
              !captchaToken ||
              !turnstileSiteKey ||
              !acceptedTerms ||
              !callbackUrl
            }
            className="w-full rounded-xl bg-gradient-primary px-4 py-3 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Verifying..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AuthGate;
