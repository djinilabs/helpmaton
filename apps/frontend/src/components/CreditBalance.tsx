import type { FC } from "react";

import { getBalanceColor } from "../utils/colorUtils";
import { formatCurrency } from "../utils/currency";

interface CreditBalanceProps {
  workspaceId: string;
  balance: number; // in nano-dollars
  canEdit: boolean;
}

export const CreditBalance: FC<CreditBalanceProps> = ({ balance }) => {
  // Ensure balance is a number
  // Balance is in nano-dollars, convert to currency units for display
  const numericBalance = Number(balance) || 0;

  // Format balance for display (convert from nano-dollars to currency units)
  // Always use USD
  const formattedBalance = formatCurrency(numericBalance, "usd", 12);

  // Get color classes based on balance level
  const balanceColorClasses = getBalanceColor(numericBalance);

  return (
    <div className="mb-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          Credit Balance
        </h2>
      </div>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
        Your workspace credit balance is used to pay for AI agent usage. Credits
        are deducted when agents process requests. You can add credits to
        maintain a positive balance.
      </p>

      <div className="flex items-center gap-4">
        <span
          className={`rounded-lg border px-4 py-2 text-4xl font-semibold ${balanceColorClasses}`}
        >
          {formattedBalance}
        </span>
        <span className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
          USD
        </span>
      </div>
      {numericBalance < 0 && (
        <div className="dark:bg-error-950 mt-4 rounded-lg border border-error-200 bg-error-50 p-3 dark:border-error-800">
          <p className="text-sm font-semibold text-error-800 dark:text-error-200">
            Warning: Negative Balance
          </p>
          <p className="mt-1 text-xs text-error-700 dark:text-error-300">
            Your balance is negative. Add credits to continue using agents.
          </p>
        </div>
      )}
    </div>
  );
};
