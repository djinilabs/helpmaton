import { useEffect, useState } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import {
  useCreateAgentSchedule,
  useUpdateAgentSchedule,
} from "../hooks/useAgentSchedules";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { AgentSchedule } from "../utils/api";

const PRESET_OPTIONS: Array<{
  value: string;
  label: string;
  cronExpression: string;
}> = [
  { value: "hourly", label: "Hourly", cronExpression: "0 * * * *" },
  { value: "daily", label: "Daily (00:00 UTC)", cronExpression: "0 0 * * *" },
  { value: "weekly", label: "Weekly (Mon 00:00 UTC)", cronExpression: "0 0 * * 1" },
  { value: "monthly", label: "Monthly (1st 00:00 UTC)", cronExpression: "0 0 1 * *" },
  { value: "custom", label: "Custom cron", cronExpression: "" },
];

interface AgentScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  agentId: string;
  schedule?: AgentSchedule;
}

export const AgentScheduleModal: FC<AgentScheduleModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  agentId,
  schedule,
}) => {
  const scheduleId = schedule?.id;
  const isEditing = !!scheduleId;
  const createSchedule = useCreateAgentSchedule(workspaceId, agentId);
  const updateSchedule = useUpdateAgentSchedule(
    workspaceId,
    agentId,
    scheduleId || ""
  );

  const [name, setName] = useState(() => schedule?.name ?? "");
  const [cronExpression, setCronExpression] = useState(
    () => schedule?.cronExpression ?? ""
  );
  const [prompt, setPrompt] = useState(() => schedule?.prompt ?? "");
  const [enabled, setEnabled] = useState(() => schedule?.enabled ?? true);
  const [preset, setPreset] = useState(() => {
    const matchedPreset = PRESET_OPTIONS.find(
      (option) => option.cronExpression === schedule?.cronExpression
    );
    return matchedPreset?.value || "custom";
  });

  const { registerDialog, unregisterDialog } = useDialogTracking();
  useEscapeKey(isOpen, handleClose);

  function handleClose() {
    onClose();
  }

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const handlePresetChange = (value: string) => {
    setPreset(value);
    const presetOption = PRESET_OPTIONS.find((option) => option.value === value);
    if (presetOption && presetOption.cronExpression) {
      setCronExpression(presetOption.cronExpression);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !cronExpression.trim() || !prompt.trim()) {
      return;
    }

    try {
      if (isEditing && scheduleId) {
        await updateSchedule.mutateAsync({
          name: name.trim(),
          cronExpression: cronExpression.trim(),
          prompt: prompt.trim(),
          enabled,
        });
      } else {
        await createSchedule.mutateAsync({
          name: name.trim(),
          cronExpression: cronExpression.trim(),
          prompt: prompt.trim(),
          enabled,
        });
      }
      handleClose();
    } catch {
      // Error handled by toast
    }
  };

  if (!isOpen) return null;

  const isPending = isEditing
    ? updateSchedule.isPending
    : createSchedule.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-6 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {isEditing ? "Edit Schedule" : "Create Schedule"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="schedule-name"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Name *
            </label>
            <input
              id="schedule-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
            />
          </div>

          <div>
            <label
              htmlFor="schedule-preset"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Schedule preset
            </label>
            <select
              id="schedule-preset"
              value={preset}
              onChange={(event) => handlePresetChange(event.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
            >
              {PRESET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="schedule-cron"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Cron expression (UTC) *
            </label>
            <input
              id="schedule-cron"
              type="text"
              value={cronExpression}
              onChange={(event) => {
                setCronExpression(event.target.value);
                setPreset("custom");
              }}
              placeholder="0 0 * * *"
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
            />
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Times are in UTC.
            </p>
          </div>

          <div>
            <label
              htmlFor="schedule-prompt"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Schedule prompt *
            </label>
            <textarea
              id="schedule-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              placeholder="Describe what the agent should do every run."
              required
            />
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              This becomes the first user message for each scheduled run.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="schedule-enabled"
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="size-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500 dark:border-neutral-700"
            />
            <label
              htmlFor="schedule-enabled"
              className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Enabled
            </label>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={
                isPending ||
                !name.trim() ||
                !cronExpression.trim() ||
                !prompt.trim()
              }
              className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Saving..." : isEditing ? "Save" : "Create"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending}
              className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
