import type { FC } from "react";

import { formatCurrency } from "../utils/currency";

interface CreditBalanceProps {
  workspaceId: string;
  balance: number; // in millionths
  canEdit: boolean;
}

export const CreditBalance: FC<CreditBalanceProps> = ({
  balance,
}) => {
  // Ensure balance is a number
  // Balance is in millionths, convert to currency units for display
  const numericBalance = Number(balance) || 0;

  // Format balance for display (convert from millionths to currency units)
  // Always use USD
  const formattedBalance = formatCurrency(numericBalance, "usd", 10);

  return (
    <div className="mb-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">Credit Balance</h2>
      </div>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
        Your workspace credit balance is used to pay for AI agent usage. Credits
        are deducted when agents process requests. You can add credits to
        maintain a positive balance.
      </p>

      <div className="flex items-baseline gap-4">
        <span className="text-4xl font-semibold text-neutral-900 dark:text-neutral-50">
          {formattedBalance}
        </span>
        <span className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
          USD
        </span>
      </div>
      {numericBalance < 0 && (
        <p className="mt-4 font-semibold text-red-700 dark:text-red-400">
          Warning: Negative Balance
        </p>
      )}
    </div>
  );
};
