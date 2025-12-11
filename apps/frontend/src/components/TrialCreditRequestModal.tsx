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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white border border-neutral-200 rounded-2xl shadow-dramatic border-2 border-neutral-300 p-8 max-w-md w-full">
        <h2 className="text-3xl font-bold text-neutral-900 mb-6">
          Request Trial Credits
        </h2>
        <p className="text-sm text-neutral-600 mb-4">
          You are within your 7-day trial period. Request trial credits (2
          EUR/USD/GBP) to test the application.
        </p>
        {daysRemaining > 0 && (
          <p className="text-sm font-medium text-neutral-900 mb-4">
            {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining in
            your trial period.
          </p>
        )}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Verify you&apos;re human
            </label>
            <div
              ref={captchaContainerRef}
              className="flex justify-center"
            ></div>
            {!turnstileSiteKey && (
              <div className="mt-2 p-3 border border-red-200 bg-red-50 rounded-xl">
                <p className="text-xs font-semibold text-red-800 mb-1">
                  CAPTCHA Configuration Missing
                </p>
                <p className="text-xs text-red-700">
                  The Cloudflare Turnstile site key is not configured. Please
                  set the{" "}
                  <code className="bg-red-100 px-1 rounded">
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
              className="flex-1 bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {requestCredits.isPending ? "Submitting..." : "Request Credits"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={requestCredits.isPending}
              className="flex-1 border border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
