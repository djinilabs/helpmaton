import { useState } from "react";
import type { FC } from "react";

import {
  useAgentSchedules,
  useDeleteAgentSchedule,
  useUpdateAgentSchedule,
} from "../hooks/useAgentSchedules";
import type { AgentSchedule } from "../utils/api";

import { AgentScheduleModal } from "./AgentScheduleModal";

interface AgentScheduleListProps {
  workspaceId: string;
  agentId: string;
  canEdit: boolean;
}

interface ScheduleItemProps {
  schedule: AgentSchedule;
  workspaceId: string;
  agentId: string;
  canEdit: boolean;
  onEdit: (scheduleId: string) => void;
}

const formatUtc = (timestampSeconds: number | null): string => {
  if (!timestampSeconds) return "Never";
  const date = new Date(timestampSeconds * 1000);
  return date.toISOString().replace("T", " ").replace("Z", " UTC");
};

const formatUtcIso = (value: string | null): string => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").replace("Z", " UTC");
};

const padTwo = (value: number) => String(value).padStart(2, "0");

const describeCron = (expression: string): string => {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return "Custom schedule (UTC)";
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (month !== "*") {
    return "Custom schedule (UTC)";
  }
  const isNumber = (value: string) => /^\d+$/.test(value);

  if (hour === "*" && dayOfMonth === "*" && dayOfWeek === "*" && isNumber(minute)) {
    return `Every hour at :${padTwo(Number(minute))} UTC`;
  }

  if (isNumber(hour) && isNumber(minute) && dayOfMonth === "*" && dayOfWeek === "*") {
    return `Every day at ${padTwo(Number(hour))}:${padTwo(Number(minute))} UTC`;
  }

  if (isNumber(hour) && isNumber(minute) && dayOfMonth === "*" && isNumber(dayOfWeek)) {
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const dayIndex = Number(dayOfWeek) === 7 ? 0 : Number(dayOfWeek);
    const dayLabel = dayNames[dayIndex] ?? "Monday";
    return `Every week on ${dayLabel} at ${padTwo(Number(hour))}:${padTwo(
      Number(minute)
    )} UTC`;
  }

  if (
    isNumber(hour) &&
    isNumber(minute) &&
    isNumber(dayOfMonth) &&
    dayOfWeek === "*"
  ) {
    return `Every month on day ${dayOfMonth} at ${padTwo(Number(hour))}:${padTwo(
      Number(minute)
    )} UTC`;
  }

  return "Custom schedule (UTC)";
};

const ScheduleItem: FC<ScheduleItemProps> = ({
  schedule,
  workspaceId,
  agentId,
  canEdit,
  onEdit,
}) => {
  const deleteSchedule = useDeleteAgentSchedule(
    workspaceId,
    agentId,
    schedule.id
  );
  const updateSchedule = useUpdateAgentSchedule(
    workspaceId,
    agentId,
    schedule.id
  );

  const handleToggleEnabled = async () => {
    try {
      await updateSchedule.mutateAsync({
        enabled: !schedule.enabled,
      });
    } catch {
      // Error handled by toast
    }
  };

  return (
    <div className="flex items-center justify-between rounded-xl border-2 border-neutral-300 bg-white p-6 transition-all duration-200 hover:scale-[1.01] hover:shadow-bold active:scale-[0.99] dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            {schedule.name}
          </div>
          {schedule.enabled ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
              Enabled
            </span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
              Disabled
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          {describeCron(schedule.cronExpression)}
        </div>
        {describeCron(schedule.cronExpression) === "Custom schedule (UTC)" && (
          <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
            Advanced: {schedule.cronExpression}
          </div>
        )}
        <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
          Next run: {formatUtc(schedule.nextRunAt)} · Last run:{" "}
          {formatUtcIso(schedule.lastRunAt)}
        </div>
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={handleToggleEnabled}
            disabled={updateSchedule.isPending}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              schedule.enabled
                ? "border border-orange-300 bg-white text-orange-600 hover:bg-orange-50 dark:border-orange-600 dark:bg-neutral-900 dark:text-orange-400 dark:hover:bg-orange-950"
                : "border border-green-300 bg-white text-green-600 hover:bg-green-50 dark:border-green-600 dark:bg-neutral-900 dark:text-green-400 dark:hover:bg-green-950"
            }`}
          >
            {updateSchedule.isPending
              ? "Updating..."
              : schedule.enabled
              ? "Disable"
              : "Enable"}
          </button>
          <button
            onClick={() => onEdit(schedule.id)}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Edit
          </button>
          <button
            onClick={async () => {
              if (
                !confirm(
                  "Are you sure you want to delete this schedule? This action cannot be undone."
                )
              ) {
                return;
              }
              try {
                await deleteSchedule.mutateAsync();
              } catch {
                // Error handled by toast
              }
            }}
            disabled={deleteSchedule.isPending}
            className="rounded-xl bg-error-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleteSchedule.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
};

export const AgentScheduleList: FC<AgentScheduleListProps> = ({
  workspaceId,
  agentId,
  canEdit,
}) => {
  const { data: schedules, isLoading } = useAgentSchedules(
    workspaceId,
    agentId
  );
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null
  );

  const handleCloseModal = () => {
    setIsCreateModalOpen(false);
    setEditingScheduleId(null);
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border-2 border-neutral-300 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
        <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
          Loading schedules...
        </p>
      </div>
    );
  }

  const schedulesList = schedules || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          All times are in UTC.
        </p>
        {canEdit && (
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:shadow-colored"
          >
            Add schedule
          </button>
        )}
      </div>

      {schedulesList.length === 0 ? (
        <div className="rounded-xl border-2 border-neutral-300 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-base font-bold text-neutral-700 dark:text-neutral-300">
            No schedules yet.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {schedulesList.map((schedule) => (
            <ScheduleItem
              key={schedule.id}
              schedule={schedule}
              workspaceId={workspaceId}
              agentId={agentId}
              canEdit={canEdit}
              onEdit={setEditingScheduleId}
            />
          ))}
        </div>
      )}

      {(isCreateModalOpen || editingScheduleId) && (
        <AgentScheduleModal
          key={editingScheduleId || "new"}
          isOpen={isCreateModalOpen || !!editingScheduleId}
          onClose={handleCloseModal}
          workspaceId={workspaceId}
          agentId={agentId}
          schedule={
            schedulesList.find((schedule) => schedule.id === editingScheduleId) ||
            undefined
          }
        />
      )}
    </div>
  );
};
