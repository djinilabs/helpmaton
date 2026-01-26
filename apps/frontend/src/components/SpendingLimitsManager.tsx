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
import { getTimeFrameColor } from "../utils/colorUtils";
import { formatCurrency, fromNanoDollars, toNanoDollars } from "../utils/currency";

import { Slider } from "./Slider";

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
      // Convert from currency units to nano-dollars for API
      await addLimit.mutateAsync({
        timeFrame: newLimit.timeFrame as "daily" | "weekly" | "monthly",
        amount: toNanoDollars(amount),
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
      // Convert from currency units to nano-dollars for API
      await updateLimit.mutateAsync({ timeFrame, amount: toNanoDollars(amount) });
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
    // Convert from nano-dollars to currency units for editing
    setEditAmount(fromNanoDollars(limit.amount).toString());
  };

  const cancelEdit = () => {
    setEditingLimit(null);
    setEditAmount("");
  };

  return (
    <div className="mb-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
      <div className="mb-4 flex items-center justify-end">
        {canEdit &&
          !isAdding &&
          spendingLimits.length > 0 &&
          availableTimeFrames.length > 0 && (
            <button
              onClick={handleStartAdding}
              className="rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:shadow-colored"
            >
              Add Limit
            </button>
          )}
      </div>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
        {agentId
          ? "Set spending limits for this specific agent to control costs. Limits can be set for daily, weekly, or monthly periods. When a limit is reached, the agent will stop processing requests until the next period."
          : "Set spending limits for this workspace to control costs across all agents. Limits can be set for daily, weekly, or monthly periods. When a limit is reached, all agents in this workspace will stop processing requests until the next period."}
      </p>

      {spendingLimits.length === 0 && !isAdding && (
        <div className="flex items-center justify-between">
          <p className="text-lg text-neutral-600 dark:text-neutral-300">
            No spending limits defined. Add a limit to control spending.
          </p>
          {canEdit && availableTimeFrames.length > 0 && (
            <button
              onClick={handleStartAdding}
              className="rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:shadow-colored"
            >
              Add Limit
            </button>
          )}
        </div>
      )}

      {isAdding && (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
          <h3 className="mb-4 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
            Add Spending Limit
          </h3>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
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
                className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
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
              <Slider
                label="Amount (USD)"
                value={newLimit.amount ? parseFloat(newLimit.amount) : undefined}
                min={0}
                max={10000}
                step={0.01}
                onChange={(value) =>
                  setNewLimit({ ...newLimit, amount: value?.toString() ?? "" })
                }
                formatValue={(v) => `$${v.toFixed(2)}`}
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
                className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
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
                className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
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
              className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
            >
              {editingLimit === limit.timeFrame ? (
                <div className="flex flex-1 items-center gap-4">
                  <div className="flex-1">
                    <div className="mb-2">
                      <span
                        className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${getTimeFrameColor(
                          limit.timeFrame
                        )}`}
                      >
                        {TIME_FRAMES.find((tf) => tf.value === limit.timeFrame)
                          ?.label || limit.timeFrame.toUpperCase()}
                      </span>
                    </div>
                    <Slider
                      value={editAmount ? parseFloat(editAmount) : undefined}
                      min={0}
                      max={10000}
                      step={0.01}
                      onChange={(value) => setEditAmount(value?.toString() ?? "")}
                      formatValue={(v) => `$${v.toFixed(2)}`}
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
                      className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {updateLimit.isPending ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={updateLimit.isPending}
                      className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${getTimeFrameColor(
                        limit.timeFrame
                      )}`}
                    >
                      {TIME_FRAMES.find((tf) => tf.value === limit.timeFrame)
                        ?.label || limit.timeFrame.toUpperCase()}
                    </span>
                    <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                      {formatCurrency(limit.amount, "usd", 10)}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(limit)}
                        className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleRemove(limit.timeFrame)}
                        disabled={removeLimit.isPending}
                        className="rounded-xl bg-error-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-700 disabled:cursor-not-allowed disabled:opacity-50"
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
