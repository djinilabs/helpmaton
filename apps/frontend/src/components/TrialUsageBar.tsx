import { useEffect, useRef } from "react";
import type { FC } from "react";

import { useTrialStatus } from "../hooks/useTrialCredits";
import { formatCurrency } from "../utils/currency";

interface TrialUsageBarProps {
  workspaceId: string;
  onUpgradeClick: () => void;
}

export const TrialUsageBar: FC<TrialUsageBarProps> = ({
  workspaceId,
  onUpgradeClick,
}) => {
  const currency = "usd";
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

  return (
    <div className="mb-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-soft">
      <h3 className="mb-4 text-xl font-semibold text-neutral-900">
        Trial Credit Usage
      </h3>
      <p className="mb-4 text-sm text-neutral-600">
        You have been granted {formatCurrency(trialStatus.initialCreditAmount, currency, 10)} in trial
        credits.
      </p>
      <div className="mb-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-neutral-700">Usage</span>
          <span className="text-sm font-semibold text-neutral-900">
            {usage.toFixed(1)}%
          </span>
        </div>
        <div className="relative h-8 w-full overflow-hidden rounded-full border border-neutral-300 bg-neutral-100">
          <div
            className="h-full bg-gradient-primary transition-all duration-300"
            style={{ width: `${usage}%` }}
          />
          {usage >= 80 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-semibold text-white">
                80% Reached
              </span>
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-neutral-600">
        {usage >= 80
          ? "You've used 80% of your trial credits. Consider upgrading to continue without interruption."
          : `${(100 - usage).toFixed(1)}% remaining`}
      </p>
    </div>
  );
};
