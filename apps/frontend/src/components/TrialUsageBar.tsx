import { useEffect, useRef } from "react";
import type { FC } from "react";

import { useTrialStatus } from "../hooks/useTrialCredits";
import type { Currency } from "../utils/api";

interface TrialUsageBarProps {
  workspaceId: string;
  currency: Currency;
  onUpgradeClick: () => void;
}

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  usd: "$",
  eur: "€",
  gbp: "£",
};

export const TrialUsageBar: FC<TrialUsageBarProps> = ({
  workspaceId,
  currency,
  onUpgradeClick,
}) => {
  const { data: trialStatus, isLoading } = useTrialStatus(workspaceId);
  const hasShownUpgradeModal = useRef(false);

  // Trigger upgrade modal at 80% usage
  useEffect(() => {
    if (
      trialStatus &&
      trialStatus.creditsApproved &&
      trialStatus.currentUsage >= 80 &&
      !hasShownUpgradeModal.current
    ) {
      hasShownUpgradeModal.current = true;
      onUpgradeClick();
    }
  }, [trialStatus, onUpgradeClick]);

  if (isLoading || !trialStatus || !trialStatus.creditsApproved) {
    return null;
  }

  const usage = Math.min(100, Math.max(0, trialStatus.currentUsage));
  const symbol = CURRENCY_SYMBOLS[currency];
  const currencyUpper = currency.toUpperCase();

  return (
    <div className="border border-neutral-200 rounded-lg p-6 mb-8 bg-white shadow-soft">
      <h3 className="text-xl font-semibold text-neutral-900 mb-4">
        Trial Credit Usage
      </h3>
      <p className="text-sm text-neutral-600 mb-4">
        You have been granted {symbol}
        {trialStatus.initialCreditAmount.toFixed(2)} {currencyUpper} in trial
        credits.
      </p>
      <div className="mb-2">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-neutral-700">Usage</span>
          <span className="text-sm font-semibold text-neutral-900">
            {usage.toFixed(1)}%
          </span>
        </div>
        <div className="w-full border border-neutral-300 rounded-full bg-neutral-100 h-8 relative overflow-hidden">
          <div
            className="h-full bg-gradient-primary transition-all duration-300"
            style={{ width: `${usage}%` }}
          />
          {usage >= 80 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-white font-semibold text-xs">
                80% Reached
              </span>
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-neutral-600 mt-2">
        {usage >= 80
          ? "You've used 80% of your trial credits. Consider upgrading to continue without interruption."
          : `${(100 - usage).toFixed(1)}% remaining`}
      </p>
    </div>
  );
};
