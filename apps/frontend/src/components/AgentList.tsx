import { useState } from "react";
import type { FC } from "react";
import { Link } from "react-router-dom";

import { useAgents } from "../hooks/useAgents";

import { AgentModal } from "./AgentModal";

interface AgentListProps {
  workspaceId: string;
  canEdit: boolean; // Based on permission level (WRITE or OWNER)
}

export const AgentList: FC<AgentListProps> = ({ workspaceId, canEdit }) => {
  const { data: agents } = useAgents(workspaceId);
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
              Create Agent
            </button>
          </div>
        )}
        <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">
          Agents are AI assistants that can process requests, access documents,
          and send notifications. Each agent has its own system prompt, spending
          limits, and usage statistics. Click on an agent to configure it.
        </p>
        {agents.length === 0 ? (
          <p className="text-lg text-neutral-600 dark:text-neutral-300">
            No agents yet. Create your first agent to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="transform cursor-pointer rounded-xl border-2 border-neutral-300 bg-white p-6 transition-all duration-200 hover:scale-[1.02] hover:border-primary-400 hover:shadow-bold active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500"
              >
                <Link
                  to={`/workspaces/${workspaceId}/agents/${agent.id}`}
                  className="text-xl font-bold text-neutral-900 transition-colors hover:text-primary-600 dark:text-neutral-50 dark:hover:text-primary-400"
                >
                  {agent.name}
                </Link>
              </div>
            ))}
          </div>
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
