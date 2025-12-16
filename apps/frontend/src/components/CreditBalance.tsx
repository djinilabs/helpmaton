import { useState, useEffect } from "react";
import type { FC } from "react";

import { useUpdateWorkspace } from "../hooks/useWorkspaces";
import type { Currency } from "../utils/api";
import { formatCurrency } from "../utils/currency";

interface CreditBalanceProps {
  workspaceId: string;
  balance: number; // in millionths
  currency: Currency;
  canEdit: boolean;
}

const CURRENCIES: Array<{ value: Currency; label: string }> = [
  { value: "usd", label: "USD ($)" },
  { value: "eur", label: "EUR (€)" },
  { value: "gbp", label: "GBP (£)" },
];

export const CreditBalance: FC<CreditBalanceProps> = ({
  workspaceId,
  balance,
  currency,
  canEdit,
}) => {
  const [isEditingCurrency, setIsEditingCurrency] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>(currency);
  const updateWorkspace = useUpdateWorkspace(workspaceId);

  // Update selectedCurrency when currency prop changes
  useEffect(() => {
    setSelectedCurrency(currency);
  }, [currency]);

  // Ensure balance is a number and check if currency change should be disabled
  // Balance is in millionths, convert to currency units for display
  const numericBalance = Number(balance) || 0;
  const isCurrencyChangeDisabled = numericBalance !== 0;

  // Format balance for display (convert from millionths to currency units)
  const formattedBalance = formatCurrency(numericBalance, currency, 4);
  const currencyUpper = currency.toUpperCase();

  const handleCurrencyChange = async () => {
    if (selectedCurrency === currency) {
      setIsEditingCurrency(false);
      return;
    }

    try {
      await updateWorkspace.mutateAsync({
        currency: selectedCurrency,
      });
      setIsEditingCurrency(false);
    } catch {
      // Error handled by toast
      setSelectedCurrency(currency); // Revert on error
    }
  };

  const cancelCurrencyEdit = () => {
    setSelectedCurrency(currency);
    setIsEditingCurrency(false);
  };

  return (
    <div className="border border-neutral-200 rounded-xl p-6 mb-8 bg-white shadow-soft">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-3xl font-bold text-neutral-900">Credit Balance</h2>
        {canEdit && !isEditingCurrency && (
          <button
            onClick={() => {
              if (isCurrencyChangeDisabled) return;
              setSelectedCurrency(currency);
              setIsEditingCurrency(true);
            }}
            disabled={isCurrencyChangeDisabled}
            title={
              isCurrencyChangeDisabled
                ? "Cannot change currency when balance is not 0"
                : undefined
            }
            className="border-2 border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Change Currency
          </button>
        )}
      </div>
      <p className="text-sm text-neutral-600 mb-4">
        Your workspace credit balance is used to pay for AI agent usage. Credits
        are deducted when agents process requests. You can add credits to
        maintain a positive balance.
      </p>

      {isEditingCurrency ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Currency
            </label>
            <select
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(e.target.value as Currency)}
              className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-colors"
            >
              {CURRENCIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCurrencyChange}
              disabled={updateWorkspace.isPending}
              className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {updateWorkspace.isPending ? "Saving..." : "Save"}
            </button>
            <button
              onClick={cancelCurrencyEdit}
              disabled={updateWorkspace.isPending}
              className="border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-4">
            <span className="text-4xl font-semibold text-neutral-900">
              {formattedBalance}
            </span>
            <span className="text-lg font-medium text-neutral-600">
              {currencyUpper}
            </span>
            {canEdit && (
              <button
                onClick={() => {
                  if (isCurrencyChangeDisabled) return;
                  setIsEditingCurrency(true);
                }}
                disabled={isCurrencyChangeDisabled}
                title={
                  isCurrencyChangeDisabled
                    ? "Cannot change currency when balance is not 0"
                    : undefined
                }
                className="ml-4 border-2 border-neutral-300 bg-white px-3 py-1 text-sm font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Change
              </button>
            )}
          </div>
          {numericBalance < 0 && (
            <p className="mt-4 text-red-700 font-semibold">
              Warning: Negative Balance
            </p>
          )}
        </>
      )}
    </div>
  );
};
