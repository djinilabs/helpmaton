import { useState } from "react";
import type { FC } from "react";

import {
  useAddWorkspaceSpendingLimit,
  useUpdateWorkspaceSpendingLimit,
  useRemoveWorkspaceSpendingLimit,
  useAddAgentSpendingLimit,
  useUpdateAgentSpendingLimit,
  useRemoveAgentSpendingLimit,
} from "../hooks/useSpendingLimits";
import { useUpdateWorkspace } from "../hooks/useWorkspaces";
import type { SpendingLimit } from "../utils/api";
import { formatCurrency, fromMillionths, toMillionths } from "../utils/currency";

interface SpendingLimitsManagerProps {
  workspaceId: string;
  agentId?: string;
  spendingLimits?: SpendingLimit[];
  canEdit: boolean;
}

const TIME_FRAMES: Array<{
  value: "daily" | "weekly" | "monthly";
  label: string;
}> = [
  { value: "daily", label: "DAILY" },
  { value: "weekly", label: "WEEKLY" },
  { value: "monthly", label: "MONTHLY" },
];


export const SpendingLimitsManager: FC<SpendingLimitsManagerProps> = ({
  workspaceId,
  agentId,
  spendingLimits = [],
  canEdit,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [newLimit, setNewLimit] = useState<{
    timeFrame: "daily" | "weekly" | "monthly" | "";
    amount: string;
  }>({ timeFrame: "", amount: "" });
  const [editAmount, setEditAmount] = useState<string>("");
  const updateWorkspace = useUpdateWorkspace(workspaceId);

  // Use agent hooks if agentId is provided, otherwise use workspace hooks
  const addWorkspaceLimit = useAddWorkspaceSpendingLimit(workspaceId);
  const updateWorkspaceLimit = useUpdateWorkspaceSpendingLimit(workspaceId);
  const removeWorkspaceLimit = useRemoveWorkspaceSpendingLimit(workspaceId);
  const addAgentLimit = useAddAgentSpendingLimit(workspaceId, agentId || "");
  const updateAgentLimit = useUpdateAgentSpendingLimit(
    workspaceId,
    agentId || ""
  );
  const removeAgentLimit = useRemoveAgentSpendingLimit(
    workspaceId,
    agentId || ""
  );

  const addLimit = agentId ? addAgentLimit : addWorkspaceLimit;
  const updateLimit = agentId ? updateAgentLimit : updateWorkspaceLimit;
  const removeLimit = agentId ? removeAgentLimit : removeWorkspaceLimit;

  const existingTimeFrames = spendingLimits.map((l) => l.timeFrame);
  const availableTimeFrames = TIME_FRAMES.filter(
    (tf) => !existingTimeFrames.includes(tf.value)
  );

  // Handler to open the add form
  const handleStartAdding = () => {
    setNewLimit({ timeFrame: "", amount: "" });
    setIsAdding(true);
  };

  const handleAdd = async () => {
    if (!newLimit.timeFrame || !newLimit.amount) return;
    const amount = parseFloat(newLimit.amount);
    if (isNaN(amount) || amount <= 0) return;

    try {
      // Convert from currency units to millionths for API
      await addLimit.mutateAsync({
        timeFrame: newLimit.timeFrame as "daily" | "weekly" | "monthly",
        amount: toMillionths(amount),
      });
      setNewLimit({ timeFrame: "", amount: "" });
      setIsAdding(false);
    } catch {
      // Error handled by toast
    }
  };

  const handleUpdate = async (timeFrame: "daily" | "weekly" | "monthly") => {
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount <= 0) return;

    try {
      // Convert from currency units to millionths for API
      await updateLimit.mutateAsync({ timeFrame, amount: toMillionths(amount) });
      setEditingLimit(null);
      setEditAmount("");
    } catch {
      // Error handled by toast
    }
  };

  const handleRemove = async (timeFrame: "daily" | "weekly" | "monthly") => {
    if (
      !confirm(
        `Are you sure you want to remove the ${timeFrame} spending limit?`
      )
    ) {
      return;
    }

    try {
      await removeLimit.mutateAsync(timeFrame);
    } catch {
      // Error handled by toast
    }
  };

  const startEdit = (limit: SpendingLimit) => {
    setEditingLimit(limit.timeFrame);
    // Convert from millionths to currency units for editing
    setEditAmount(fromMillionths(limit.amount).toString());
  };

  const cancelEdit = () => {
    setEditingLimit(null);
    setEditAmount("");
  };

  return (
    <div className="border border-neutral-200 rounded-xl p-6 mb-8 bg-white shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">Spending Limits</h2>
        {canEdit &&
          !isAdding &&
          spendingLimits.length > 0 &&
          availableTimeFrames.length > 0 && (
            <button
              onClick={handleStartAdding}
              className="bg-gradient-primary px-4 py-2.5 text-white text-sm font-semibold rounded-xl hover:shadow-colored transition-colors"
            >
              Add Limit
            </button>
          )}
      </div>
      <p className="text-sm text-neutral-600 mb-4 dark:text-neutral-300">
        {agentId
          ? "Set spending limits for this specific agent to control costs. Limits can be set for daily, weekly, or monthly periods. When a limit is reached, the agent will stop processing requests until the next period."
          : "Set spending limits for this workspace to control costs across all agents. Limits can be set for daily, weekly, or monthly periods. When a limit is reached, all agents in this workspace will stop processing requests until the next period."}
      </p>

      {spendingLimits.length === 0 && !isAdding && (
        <div className="flex justify-between items-center">
          <p className="text-lg text-neutral-600 dark:text-neutral-300">
            No spending limits defined. Add a limit to control spending.
          </p>
          {canEdit && availableTimeFrames.length > 0 && (
            <button
              onClick={handleStartAdding}
              className="bg-gradient-primary px-4 py-2.5 text-white text-sm font-semibold rounded-xl hover:shadow-colored transition-colors"
            >
              Add Limit
            </button>
          )}
        </div>
      )}

      {isAdding && (
        <div className="border border-neutral-200 rounded-xl p-4 mb-4 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
          <h3 className="text-xl font-semibold text-neutral-900 mb-4 dark:text-neutral-50">
            Add Spending Limit
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2 dark:text-neutral-300">
                Time Frame
              </label>
              <select
                value={newLimit.timeFrame}
                onChange={(e) =>
                  setNewLimit({
                    ...newLimit,
                    timeFrame: e.target.value as
                      | "daily"
                      | "weekly"
                      | "monthly"
                      | "",
                  })
                }
                className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
              >
                <option value="">Select time frame</option>
                {availableTimeFrames.map((tf) => (
                  <option key={tf.value} value={tf.value}>
                    {tf.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700 mb-2 dark:text-neutral-300">
                Amount (USD)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={newLimit.amount}
                onChange={(e) =>
                  setNewLimit({ ...newLimit, amount: e.target.value })
                }
                className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
                placeholder="0.00"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleAdd}
                disabled={
                  addLimit.isPending ||
                  updateWorkspace.isPending ||
                  !newLimit.timeFrame ||
                  !newLimit.amount ||
                  parseFloat(newLimit.amount) <= 0
                }
                className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {addLimit.isPending || updateWorkspace.isPending
                  ? "Adding..."
                  : "Add"}
              </button>
              <button
                onClick={() => {
                  setIsAdding(false);
                  setNewLimit({ timeFrame: "", amount: "" });
                }}
                disabled={addLimit.isPending || updateWorkspace.isPending}
                className="border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {spendingLimits.length > 0 && (
        <div className="space-y-3">
          {spendingLimits.map((limit) => (
            <div
              key={limit.timeFrame}
              className="border border-neutral-200 rounded-xl p-4 bg-white flex justify-between items-center dark:border-neutral-700 dark:bg-neutral-900"
            >
              {editingLimit === limit.timeFrame ? (
                <div className="flex-1 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-neutral-700 mb-2 dark:text-neutral-300">
                      {TIME_FRAMES.find((tf) => tf.value === limit.timeFrame)
                        ?.label || limit.timeFrame.toUpperCase()}
                    </div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdate(limit.timeFrame)}
                      disabled={
                        updateLimit.isPending ||
                        !editAmount ||
                        parseFloat(editAmount) <= 0
                      }
                      className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {updateLimit.isPending ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={updateLimit.isPending}
                      className="border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <div className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
                      {TIME_FRAMES.find((tf) => tf.value === limit.timeFrame)
                        ?.label || limit.timeFrame.toUpperCase()}
                    </div>
                    <div className="text-lg mt-1 text-neutral-700 dark:text-neutral-300">
                      {formatCurrency(limit.amount, "usd", 2)}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(limit)}
                        className="border-2 border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 transition-colors dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleRemove(limit.timeFrame)}
                        disabled={removeLimit.isPending}
                        className="bg-error-600 px-4 py-2.5 text-white text-sm font-semibold rounded-xl hover:bg-error-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {removeLimit.isPending ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
