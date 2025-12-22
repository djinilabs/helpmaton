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
          <div className="flex justify-end items-center mb-4">
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-gradient-primary px-6 py-3.5 text-white font-bold rounded-xl hover:shadow-colored transition-all duration-200 transform hover:scale-[1.03] active:scale-[0.97]"
            >
              Create Agent
            </button>
          </div>
        )}
        <p className="text-sm text-neutral-600 mb-6 dark:text-neutral-300">
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
                className="border-2 border-neutral-300 rounded-xl p-6 bg-white hover:shadow-bold hover:border-primary-400 transition-all duration-200 cursor-pointer transform hover:scale-[1.02] active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500"
              >
                <Link
                  to={`/workspaces/${workspaceId}/agents/${agent.id}`}
                  className="text-xl font-bold text-neutral-900 hover:text-primary-600 transition-colors dark:text-neutral-50 dark:hover:text-primary-400"
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
