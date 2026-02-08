import { useRef, useState } from "react";
import type { FC } from "react";

import {
  useAgentSchedulesInfinite,
  useDeleteAgentSchedule,
  useUpdateAgentSchedule,
} from "../hooks/useAgentSchedules";
import type { AgentSchedule } from "../utils/api";
import { describeCronExpression } from "../utils/scheduleCron";
import { trackEvent } from "../utils/tracking";

import { AgentScheduleModal } from "./AgentScheduleModal";
import { ScrollContainer } from "./ScrollContainer";
import { VirtualList } from "./VirtualList";

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

const formatUtcFromDate = (date: Date): string =>
  date.toISOString().replace("T", " ").replace("Z", " UTC");

const formatUtc = (timestampSeconds: number | null): string => {
  if (!timestampSeconds) return "Never";
  const date = new Date(timestampSeconds * 1000);
  return formatUtcFromDate(date);
};

const formatUtcIso = (value: string | null): string => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatUtcFromDate(date);
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
      const updatedSchedule = await updateSchedule.mutateAsync({
        enabled: !schedule.enabled,
      });
      trackEvent("agent_schedule_toggled", {
        workspace_id: workspaceId,
        agent_id: agentId,
        schedule_id: updatedSchedule.id,
        enabled: updatedSchedule.enabled,
      });
    } catch {
      // Error handled by toast
    }
  };

  const scheduleDescription = describeCronExpression(schedule.cronExpression);

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
          {scheduleDescription}
        </div>
        {scheduleDescription === "Custom schedule (UTC)" && (
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
            onClick={() => {
              trackEvent("agent_schedule_edit_started", {
                workspace_id: workspaceId,
                agent_id: agentId,
                schedule_id: schedule.id,
              });
              onEdit(schedule.id);
            }}
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
                trackEvent("agent_schedule_deleted", {
                  workspace_id: workspaceId,
                  agent_id: agentId,
                  schedule_id: schedule.id,
                });
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    data: schedulesData,
    isLoading,
    hasNextPage: hasNextSchedulesPage,
    isFetchingNextPage: isFetchingNextSchedules,
    fetchNextPage: fetchNextSchedulesPage,
  } = useAgentSchedulesInfinite(workspaceId, agentId, 50);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null
  );

  const handleCloseModal = () => {
    setIsCreateModalOpen(false);
    setEditingScheduleId(null);
  };

  const schedulesList: AgentSchedule[] =
    schedulesData?.pages.flatMap((p) => p.schedules) ?? [];

  if (isLoading) {
    return (
      <div className="rounded-xl border-2 border-neutral-300 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
        <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
          Loading schedules...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          All times are in UTC.
        </p>
        {canEdit && (
          <button
            onClick={() => {
              trackEvent("agent_schedule_create_started", {
                workspace_id: workspaceId,
                agent_id: agentId,
              });
              setIsCreateModalOpen(true);
            }}
            className="rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:shadow-colored"
          >
            ✨ Add schedule
          </button>
        )}
      </div>

      <ScrollContainer ref={scrollRef} maxHeight="min(60vh, 500px)">
        <VirtualList<AgentSchedule>
          scrollRef={scrollRef}
          items={schedulesList}
          estimateSize={() => 140}
          getItemKey={(_i, schedule) => schedule.id}
          renderRow={(schedule) => (
            <div className="border-b border-neutral-200 last:border-b-0 dark:border-neutral-700">
              <ScheduleItem
                schedule={schedule}
                workspaceId={workspaceId}
                agentId={agentId}
                canEdit={canEdit}
                onEdit={setEditingScheduleId}
              />
            </div>
          )}
          hasNextPage={hasNextSchedulesPage ?? false}
          isFetchingNextPage={isFetchingNextSchedules}
          fetchNextPage={fetchNextSchedulesPage}
          empty={
            <div className="rounded-xl border-2 border-neutral-300 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
              <p className="text-base font-bold text-neutral-700 dark:text-neutral-300">
                No schedules yet.
              </p>
            </div>
          }
        />
      </ScrollContainer>

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
