import { useRef, useState } from "react";
import type { FC } from "react";

import {
  useEvalJudgesInfinite,
  useDeleteEvalJudge,
  useUpdateEvalJudge,
} from "../hooks/useEvalJudges";
import type { EvalJudge } from "../utils/api";

import { EvalJudgeModal } from "./EvalJudgeModal";
import { ScrollContainer } from "./ScrollContainer";
import { VirtualList } from "./VirtualList";

interface EvalJudgeListProps {
  workspaceId: string;
  agentId: string;
  canEdit: boolean;
}

interface EvalJudgeItemProps {
  judge: EvalJudge;
  workspaceId: string;
  agentId: string;
  canEdit: boolean;
  onEdit: (judgeId: string) => void;
}

const EvalJudgeItem: FC<EvalJudgeItemProps> = ({
  judge,
  workspaceId,
  agentId,
  canEdit,
  onEdit,
}) => {
  const deleteJudge = useDeleteEvalJudge(workspaceId, agentId, judge.id);
  const updateJudge = useUpdateEvalJudge(workspaceId, agentId, judge.id);

  const handleToggleEnabled = async () => {
    try {
      await updateJudge.mutateAsync({
        enabled: !judge.enabled,
      });
    } catch {
      // Error is handled by toast in the hook
    }
  };

  return (
    <div className="flex transform items-center justify-between rounded-xl border-2 border-neutral-300 bg-white p-6 transition-all duration-200 hover:scale-[1.01] hover:shadow-bold active:scale-[0.99] dark:border-neutral-700 dark:bg-surface-50">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            {judge.name}
          </div>
          {judge.enabled ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
              Enabled
            </span>
          ) : (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-800 dark:bg-surface-100 dark:text-neutral-200">
              Disabled
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Provider: {judge.provider} | Model: {judge.modelName} | Sampling:{" "}
          {judge.samplingProbability}%
        </div>
        <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
          Created: {new Date(judge.createdAt).toLocaleDateString()}
        </div>
      </div>
      {canEdit && (
        <div className="flex gap-2">
          <button
            onClick={handleToggleEnabled}
            disabled={updateJudge.isPending}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              judge.enabled
                ? "border border-orange-300 bg-white text-orange-600 hover:bg-orange-50 dark:border-orange-600 dark:bg-surface-50 dark:text-orange-400 dark:hover:bg-orange-950"
                : "border border-green-300 bg-white text-green-600 hover:bg-green-50 dark:border-green-600 dark:bg-surface-50 dark:text-green-400 dark:hover:bg-green-950"
            }`}
          >
            {updateJudge.isPending
              ? "Updating..."
              : judge.enabled
              ? "Disable"
              : "Enable"}
          </button>
          <button
            onClick={() => onEdit(judge.id)}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Edit
          </button>
          <button
            onClick={async () => {
              if (
                !confirm(
                  "Are you sure you want to delete this evaluation judge? This action cannot be undone."
                )
              ) {
                return;
              }
              try {
                await deleteJudge.mutateAsync();
              } catch {
                // Error is handled by toast in the hook
              }
            }}
            disabled={deleteJudge.isPending}
            className="rounded-xl bg-error-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleteJudge.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
};

export const EvalJudgeList: FC<EvalJudgeListProps> = ({
  workspaceId,
  agentId,
  canEdit,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    data: judgesData,
    isLoading,
    hasNextPage: hasNextJudgesPage,
    isFetchingNextPage: isFetchingNextJudges,
    fetchNextPage: fetchNextJudgesPage,
  } = useEvalJudgesInfinite(workspaceId, agentId, 50);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingJudge, setEditingJudge] = useState<string | null>(null);

  const handleCloseModal = () => {
    setIsCreateModalOpen(false);
    setEditingJudge(null);
  };

  const handleEdit = (judgeId: string) => {
    setEditingJudge(judgeId);
  };

  const judgesList: EvalJudge[] =
    judgesData?.pages.flatMap((p) => p.judges) ?? [];

  if (isLoading) {
    return (
      <div className="rounded-xl border-2 border-neutral-300 bg-white p-6 dark:border-neutral-700 dark:bg-surface-50">
        <p className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
          Loading evaluation judges...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:shadow-colored"
          >
            ✨ Create Judge
          </button>
        </div>
      )}

      <ScrollContainer ref={scrollRef} maxHeight="min(60vh, 500px)">
        <VirtualList<EvalJudge>
          scrollRef={scrollRef}
          items={judgesList}
          estimateSize={() => 140}
          getItemKey={(_i, judge) => judge.id}
          renderRow={(judge) => (
            <div className="border-b border-neutral-200 last:border-b-0 dark:border-neutral-700">
              <EvalJudgeItem
                judge={judge}
                workspaceId={workspaceId}
                agentId={agentId}
                canEdit={canEdit}
                onEdit={handleEdit}
              />
            </div>
          )}
          hasNextPage={hasNextJudgesPage ?? false}
          isFetchingNextPage={isFetchingNextJudges}
          fetchNextPage={fetchNextJudgesPage}
          empty={
            <div className="rounded-xl border-2 border-neutral-300 bg-white p-6 dark:border-neutral-700 dark:bg-surface-50">
              <p className="text-base font-bold text-neutral-700 dark:text-neutral-300">
                No evaluation judges configured.
              </p>
            </div>
          }
        />
      </ScrollContainer>

      {(isCreateModalOpen || editingJudge) && (
        <EvalJudgeModal
          isOpen={isCreateModalOpen || !!editingJudge}
          onClose={handleCloseModal}
          workspaceId={workspaceId}
          agentId={agentId}
          judgeId={editingJudge || undefined}
        />
      )}
    </div>
  );
};
