import type { FC } from "react";

import type { BotIntegration } from "../utils/api";

interface IntegrationCardProps {
  integration: BotIntegration;
  onDelete: (id: string) => void;
  onUpdate: (id: string, status: "active" | "inactive" | "error") => void;
  onInstallCommand?: (integrationId: string, currentCommandName?: string) => void;
}

export const IntegrationCard: FC<IntegrationCardProps> = ({
  integration,
  onDelete,
  onUpdate,
  onInstallCommand,
}) => {
  const statusColors = {
    active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    inactive: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
    error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  };

  const isDiscord = integration.platform === "discord";
  const hasCommand = !!integration.discordCommand;
  const canInstallCommand = isDiscord && integration.status === "active" && onInstallCommand;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
              {integration.name}
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                statusColors[integration.status]
              }`}
            >
              {integration.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {integration.platform === "slack" ? "Slack" : "Discord"} Bot
          </p>
          {hasCommand && integration.discordCommand && (
            <p className="mt-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Command: <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs dark:bg-neutral-800">/{integration.discordCommand.commandName}</code>
            </p>
          )}
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-500">
            Agent ID: {integration.agentId}
          </p>
          {integration.lastUsedAt && (
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
              Last used: {new Date(integration.lastUsedAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {canInstallCommand && (
            <button
              onClick={() => onInstallCommand(integration.id, integration.discordCommand?.commandName)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {hasCommand ? "Update Command" : "Install Command"}
            </button>
          )}
          <div className="flex gap-2">
            <button
              onClick={() =>
                onUpdate(
                  integration.id,
                  integration.status === "active" ? "inactive" : "active"
                )
              }
              className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {integration.status === "active" ? "Deactivate" : "Activate"}
            </button>
            <button
              onClick={() => onDelete(integration.id)}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
