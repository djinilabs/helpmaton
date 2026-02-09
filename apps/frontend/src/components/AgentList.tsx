import { useState, useMemo, useRef } from "react";
import type { FC } from "react";
import { Link } from "react-router-dom";

import { useAgentsInfinite } from "../hooks/useAgents";
import { getDefaultAvatar } from "../utils/avatarUtils";

import { AgentModal } from "./AgentModal";
import { ScrollContainer } from "./ScrollContainer";
import { VirtualList } from "./VirtualList";

interface AgentListProps {
  workspaceId: string;
  canEdit: boolean; // Based on permission level (WRITE or OWNER)
}

export const AgentList: FC<AgentListProps> = ({ workspaceId, canEdit }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useAgentsInfinite(workspaceId, 50);

  const agents = useMemo(
    () => data?.pages.flatMap((p) => p.agents) ?? [],
    [data],
  );

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const handleCloseModal = () => {
    setIsCreateModalOpen(false);
  };

  return (
    <>
      <div>
        {canEdit && (
          <div className="mb-4 flex items-center justify-end">
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="transform rounded-xl bg-gradient-primary px-6 py-3.5 font-bold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-colored active:scale-[0.97]"
            >
              ✨ Create Agent
            </button>
          </div>
        )}
        <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">
          Agents are AI assistants that can process requests, access documents,
          and send notifications. Each agent has its own system prompt, spending
          limits, and usage statistics. Click on an agent to configure it.
        </p>
        {!isLoading && agents.length === 0 ? (
          <p className="text-lg text-neutral-600 dark:text-neutral-300">
            No agents yet. Create your first agent to get started.
          </p>
        ) : (
          <ScrollContainer ref={scrollRef} className="mb-4">
            <VirtualList
              scrollRef={scrollRef}
              items={agents}
              estimateSize={() => 96}
              getItemKey={(_, a) => a.id}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              fetchNextPage={fetchNextPage}
              empty={
                <p className="py-4 text-lg text-neutral-600 dark:text-neutral-300">
                  No agents yet. Create your first agent to get started.
                </p>
              }
              renderRow={(agent) => {
                const avatar = agent.avatar || getDefaultAvatar();
                return (
                  <div className="mb-3">
                    <div className="transform cursor-pointer rounded-xl border-2 border-neutral-300 bg-white p-6 transition-all duration-200 hover:scale-[1.02] hover:border-primary-400 hover:shadow-bold active:scale-[0.98] dark:border-neutral-700 dark:bg-surface-50 dark:hover:border-primary-500">
                      <Link
                        to={`/workspaces/${workspaceId}/agents/${agent.id}`}
                        className="flex items-center gap-4"
                      >
                        <img
                          src={avatar}
                          alt={`${agent.name} avatar`}
                          className="size-12 rounded-lg border-2 border-neutral-300 object-contain dark:border-neutral-700"
                        />
                        <span className="text-xl font-bold text-neutral-900 transition-colors hover:text-primary-600 dark:text-neutral-50 dark:hover:text-primary-400">
                          {agent.name}
                        </span>
                      </Link>
                    </div>
                  </div>
                );
              }}
            />
          </ScrollContainer>
        )}
      </div>

      {isCreateModalOpen && (
        <AgentModal
          isOpen={isCreateModalOpen}
          onClose={handleCloseModal}
          workspaceId={workspaceId}
        />
      )}
    </>
  );
};
