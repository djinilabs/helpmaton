import { useState } from "react";
import type { FC } from "react";

import { useCreditPurchase } from "../hooks/useSubscription";

interface CreditPurchaseProps {
  workspaceId?: string;
  workspaces?: Array<{ id: string; name: string }>;
}

export const CreditPurchase: FC<CreditPurchaseProps> = ({
  workspaceId,
  workspaces,
}) => {
  const currency = "usd";
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(
    workspaceId || ""
  );
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  const purchaseMutation = useCreditPurchase();

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAmount(value);
    setAmountError(null);

    // Validate amount
    const numValue = parseFloat(value);
    if (value && (isNaN(numValue) || numValue <= 0)) {
      setAmountError("Amount must be a positive number");
    } else if (value && numValue < 1) {
      setAmountError(`Minimum purchase amount is 1 ${currency.toUpperCase()}`);
    } else if (value && !/^\d+(\.\d{1,2})?$/.test(value)) {
      setAmountError("Amount must have at most 2 decimal places");
    }
  };

  const handlePurchase = () => {
    if (!selectedWorkspaceId) {
      setAmountError("Please select a workspace");
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount < 1) {
      setAmountError(`Amount must be at least 1 ${currency.toUpperCase()}`);
      return;
    }

    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      setAmountError("Amount must have at most 2 decimal places");
      return;
    }

    purchaseMutation.mutate({
      workspaceId: selectedWorkspaceId,
      amount: numAmount,
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-medium p-8 border border-neutral-200 dark:bg-neutral-900 dark:border-neutral-700">
      <h2 className="text-2xl font-semibold text-neutral-900 mb-6 dark:text-neutral-50">
        Purchase Credits
      </h2>

      <div className="space-y-4">
        {!workspaceId && workspaces && workspaces.length > 0 && (
          <div>
            <label
              htmlFor="workspace"
              className="block text-sm font-semibold text-neutral-900 mb-2 dark:text-neutral-300"
            >
              Workspace
            </label>
            <select
              id="workspace"
              value={selectedWorkspaceId}
              onChange={(e) => setSelectedWorkspaceId(e.target.value)}
              className="w-full border border-neutral-300 rounded-xl bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
            >
              <option value="">Select a workspace</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label
            htmlFor="amount"
            className="block text-sm font-semibold text-neutral-900 mb-2 dark:text-neutral-300"
          >
            Credit Amount ({currency.toUpperCase()})
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-600 font-medium dark:text-neutral-300">
              $
            </span>
            <input
              id="amount"
              type="number"
              step="0.01"
              min="1"
              value={amount}
              onChange={handleAmountChange}
              placeholder="0.00"
              className="w-full border border-neutral-300 rounded-xl bg-white pl-10 pr-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:placeholder:text-neutral-400 dark:focus:ring-primary-400 dark:focus:border-primary-500"
            />
          </div>
          {amountError && (
            <div className="mt-2 text-sm font-semibold text-error-600 dark:text-error-400">
              {amountError}
            </div>
          )}
          <div className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            Minimum: 1 {currency.toUpperCase()}. The exact amount you enter will
            be added as credits to your workspace.
          </div>
        </div>

        <button
          onClick={handlePurchase}
          disabled={
            purchaseMutation.isPending ||
            !selectedWorkspaceId ||
            !amount ||
            !!amountError ||
            parseFloat(amount) < 1
          }
          className="w-full bg-gradient-primary text-white font-semibold py-3 px-6 rounded-xl hover:shadow-colored transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {purchaseMutation.isPending ? "Processing..." : "Purchase Credits"}
        </button>
      </div>
    </div>
  );
};
