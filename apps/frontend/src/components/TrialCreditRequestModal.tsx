import { useState, useEffect, useRef } from "react";
import type { FC } from "react";

import { useEscapeKey } from "../hooks/useEscapeKey";
import {
  useRequestTrialCredits,
  useTrialStatus,
} from "../hooks/useTrialCredits";

interface TrialCreditRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
}

// Extend Window interface for Turnstile
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

export const TrialCreditRequestModal: FC<TrialCreditRequestModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
}) => {
  const requestCredits = useRequestTrialCredits();
  const { data: trialStatus } = useTrialStatus(workspaceId);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaWidgetId = useRef<string | null>(null);
  const captchaContainerRef = useRef<HTMLDivElement>(null);

  const turnstileSiteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (
      isOpen &&
      turnstileSiteKey &&
      captchaContainerRef.current &&
      !captchaWidgetId.current
    ) {
      // Render Turnstile widget
      if (window.turnstile) {
        const widgetId = window.turnstile.render(captchaContainerRef.current, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => {
            setCaptchaToken(token);
          },
          "error-callback": () => {
            setCaptchaToken(null);
          },
          "expired-callback": () => {
            setCaptchaToken(null);
          },
        });
        captchaWidgetId.current = widgetId;
      }
    }

    return () => {
      // Cleanup: remove Turnstile widget when modal closes
      if (captchaWidgetId.current && window.turnstile) {
        window.turnstile.remove(captchaWidgetId.current);
        captchaWidgetId.current = null;
      }
      setCaptchaToken(null);
    };
  }, [isOpen, turnstileSiteKey]);

  const handleClose = () => {
    if (captchaWidgetId.current && window.turnstile) {
      window.turnstile.remove(captchaWidgetId.current);
      captchaWidgetId.current = null;
    }
    setCaptchaToken(null);
    onClose();
  };

  useEscapeKey(isOpen, handleClose);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaToken || !turnstileSiteKey) {
      return;
    }

    try {
      await requestCredits.mutateAsync({
        workspaceId,
        captchaToken,
      });
      handleClose();
    } catch {
      // Error is handled by toast in the hook
      // Reset CAPTCHA on error
      if (captchaWidgetId.current && window.turnstile) {
        window.turnstile.reset(captchaWidgetId.current);
        setCaptchaToken(null);
      }
    }
  };

  if (!isOpen) return null;

  const daysRemaining = trialStatus?.daysRemaining ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-md rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-6 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          Request Trial Credits
        </h2>
        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
          You are within your 7-day trial period. Request trial credits (2
          USD) to test the application.
        </p>
        {daysRemaining > 0 && (
          <p className="mb-4 text-sm font-medium text-neutral-900 dark:text-neutral-50">
            {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining in
            your trial period.
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Verify you&apos;re human
            </label>
            <div
              ref={captchaContainerRef}
              className="flex justify-center"
            ></div>
            {!turnstileSiteKey && (
              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                <p className="mb-1 text-xs font-semibold text-red-800 dark:text-red-400">
                  CAPTCHA Configuration Missing
                </p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  The Cloudflare Turnstile site key is not configured. Please
                  set the{" "}
                  <code className="rounded bg-red-100 px-1 dark:bg-red-900 dark:text-red-50">
                    VITE_CLOUDFLARE_TURNSTILE_SITE_KEY
                  </code>{" "}
                  environment variable.
                </p>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={
                requestCredits.isPending || !captchaToken || !turnstileSiteKey
              }
              className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
            >
              {requestCredits.isPending ? "Submitting..." : "Request Credits"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={requestCredits.isPending}
              className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
