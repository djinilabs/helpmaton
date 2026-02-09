import { useEffect, useMemo, useState } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import {
  useCreateAgentSchedule,
  useUpdateAgentSchedule,
} from "../hooks/useAgentSchedules";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { AgentSchedule } from "../utils/api";
import {
  DAYS_OF_WEEK,
  buildCronExpression,
  describeSchedule,
  parseCronExpression,
  type ScheduleFrequency,
} from "../utils/scheduleCron";
import { trackEvent } from "../utils/tracking";

const FREQUENCY_OPTIONS: Array<{
  value: ScheduleFrequency;
  label: string;
}> = [
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "custom", label: "Advanced (custom)" },
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
  const initialScheduleState = useMemo(
    () => parseCronExpression(schedule?.cronExpression),
    [schedule?.cronExpression]
  );
  const [frequency, setFrequency] = useState<ScheduleFrequency>(
    () => initialScheduleState.frequency
  );
  const [timeOfDay, setTimeOfDay] = useState(
    () => initialScheduleState.timeOfDay
  );
  const [minuteOfHour, setMinuteOfHour] = useState(
    () => initialScheduleState.minuteOfHour
  );
  const [dayOfMonth, setDayOfMonth] = useState(
    () => initialScheduleState.dayOfMonth
  );
  const [dayOfWeek, setDayOfWeek] = useState(
    () => initialScheduleState.dayOfWeek
  );
  const [customCron, setCustomCron] = useState(
    () => initialScheduleState.customCron
  );
  const [prompt, setPrompt] = useState(() => schedule?.prompt ?? "");
  const [enabled, setEnabled] = useState(() => schedule?.enabled ?? true);

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

  const cronExpression = useMemo(
    () =>
      buildCronExpression({
        frequency,
        timeOfDay,
        minuteOfHour,
        dayOfMonth,
        dayOfWeek,
        customCron,
      }),
    [frequency, timeOfDay, minuteOfHour, dayOfMonth, dayOfWeek, customCron]
  );
  const scheduleDescription = useMemo(
    () =>
      describeSchedule({
        frequency,
        timeOfDay,
        minuteOfHour,
        dayOfMonth,
        dayOfWeek,
      }),
    [frequency, timeOfDay, minuteOfHour, dayOfMonth, dayOfWeek]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !cronExpression.trim() || !prompt.trim()) {
      return;
    }

    try {
      if (isEditing && scheduleId) {
        const updatedSchedule = await updateSchedule.mutateAsync({
          name: name.trim(),
          cronExpression: cronExpression.trim(),
          prompt: prompt.trim(),
          enabled,
        });
        trackEvent("agent_schedule_updated", {
          workspace_id: workspaceId,
          agent_id: agentId,
          schedule_id: updatedSchedule.id,
          frequency,
          enabled: updatedSchedule.enabled,
          is_custom: frequency === "custom",
        });
      } else {
        const createdSchedule = await createSchedule.mutateAsync({
          name: name.trim(),
          cronExpression: cronExpression.trim(),
          prompt: prompt.trim(),
          enabled,
        });
        trackEvent("agent_schedule_created", {
          workspace_id: workspaceId,
          agent_id: agentId,
          schedule_id: createdSchedule.id,
          frequency,
          enabled: createdSchedule.enabled,
          is_custom: frequency === "custom",
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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-surface-50">
        <h2 className="mb-6 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {isEditing ? "Edit schedule" : "Create schedule"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="schedule-name"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Schedule name *
            </label>
            <input
              id="schedule-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
              placeholder="e.g., Daily check-in"
            />
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              This is just for you to recognize the schedule.
            </p>
          </div>

          <div>
            <label
              htmlFor="schedule-frequency"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              How often should this run?
            </label>
            <select
              id="schedule-frequency"
              value={frequency}
              onChange={(event) =>
                setFrequency(event.target.value as ScheduleFrequency)
              }
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
            >
              {FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {frequency === "hourly" && (
            <div>
              <label
                htmlFor="schedule-minute"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Minute of the hour (UTC)
              </label>
              <input
                id="schedule-minute"
                type="number"
                min={0}
                max={59}
                value={minuteOfHour}
                onChange={(event) => setMinuteOfHour(event.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              />
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Runs at that minute every hour (UTC).
              </p>
            </div>
          )}

          {(frequency === "daily" ||
            frequency === "weekly" ||
            frequency === "monthly") && (
            <div>
              <label
                htmlFor="schedule-time"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Time of day (UTC)
              </label>
              <input
                id="schedule-time"
                type="time"
                value={timeOfDay}
                onChange={(event) => setTimeOfDay(event.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              />
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Times are always in UTC.
              </p>
            </div>
          )}

          {frequency === "weekly" && (
            <div>
              <label
                htmlFor="schedule-day-of-week"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Day of the week
              </label>
              <select
                id="schedule-day-of-week"
                value={dayOfWeek}
                onChange={(event) => setDayOfWeek(event.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              >
                {DAYS_OF_WEEK.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {frequency === "monthly" && (
            <div>
              <label
                htmlFor="schedule-day-of-month"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Day of the month
              </label>
              <input
                id="schedule-day-of-month"
                type="number"
                min={1}
                max={31}
                value={dayOfMonth}
                onChange={(event) => setDayOfMonth(event.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              />
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                If the month has fewer days, it will run on the last day.
              </p>
            </div>
          )}

          {frequency === "custom" && (
            <div>
              <label
                htmlFor="schedule-cron"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Advanced schedule (cron)
              </label>
              <input
                id="schedule-cron"
                type="text"
                value={customCron}
                onChange={(event) => setCustomCron(event.target.value)}
                placeholder="0 0 * * *"
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                required
              />
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Use this only if you already know cron expressions (UTC).
              </p>
            </div>
          )}

          <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 text-sm text-primary-800 dark:border-primary-900 dark:bg-primary-950 dark:text-primary-200">
            {scheduleDescription}
          </div>

          <div>
            <label
              htmlFor="schedule-prompt"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              What should the agent do? *
            </label>
            <textarea
              id="schedule-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              placeholder="e.g., Summarize new customer feedback from the last 24 hours."
              required
            />
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              We will send this as the first message every time it runs.
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
              Turn on this schedule
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
              {isPending
                ? isEditing
                  ? "Saving..."
                  : "✨ Saving..."
                : isEditing
                ? "Save changes"
                : "✨ Create schedule"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending}
              className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
