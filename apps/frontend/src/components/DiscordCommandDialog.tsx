import type { FC } from "react";
import { useEffect, useState } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useToast } from "../hooks/useToast";
import { registerDiscordCommand } from "../utils/api";
import { trackEvent } from "../utils/tracking";

interface DiscordCommandDialogProps {
  workspaceId: string;
  integrationId: string;
  currentCommandName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Validates a Discord command name according to Discord's requirements
 */
function validateCommandName(name: string): string | null {
  if (!name || name.length === 0) {
    return "Command name is required";
  }
  if (name.length > 32) {
    return "Command name must be 1-32 characters";
  }
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return "Command name must contain only lowercase letters, numbers, hyphens, and underscores";
  }
  if (/^[0-9]/.test(name)) {
    return "Command name must not start with a number";
  }
  return null;
}

export const DiscordCommandDialog: FC<DiscordCommandDialogProps> = ({
  workspaceId,
  integrationId,
  currentCommandName,
  onClose,
  onSuccess,
}) => {
  const [commandName, setCommandName] = useState(currentCommandName || "");
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const toast = useToast();
  const { registerDialog, unregisterDialog } = useDialogTracking();

  // Handle Escape key to close modal
  useEscapeKey(true, onClose);

  // Register dialog for focus management
  useEffect(() => {
    registerDialog();
    return () => unregisterDialog();
  }, [registerDialog, unregisterDialog]);

  const handleSubmit = async () => {
    // Validate command name
    const error = validateCommandName(commandName);
    if (error) {
      setValidationError(error);
      return;
    }

    setValidationError(null);
    setIsLoading(true);

    try {
      await registerDiscordCommand(workspaceId, integrationId, commandName);
      trackEvent("discord_command_installed", {
        workspace_id: workspaceId,
        integration_id: integrationId,
        command_name: commandName,
        is_update: !!currentCommandName,
      });
      toast.success(
        currentCommandName
          ? "Command updated successfully"
          : "Command installed successfully"
      );
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to register Discord command"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCommandNameChange = (value: string) => {
    // Convert to lowercase as user types
    const lowerValue = value.toLowerCase();
    setCommandName(lowerValue);
    // Clear validation error when user starts typing
    if (validationError) {
      setValidationError(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl dark:bg-surface-50">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">
            {currentCommandName ? "Update Discord Command" : "Install Discord Command"}
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-900/20">
            <h4 className="mb-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
              About Discord Commands
            </h4>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Discord slash commands allow users to interact with your bot by typing{" "}
              <code className="rounded bg-blue-100 px-1 py-0.5 dark:bg-blue-900/40">
                /command-name
              </code>{" "}
              in Discord. Once installed, users can use this command to chat with your AI agent.
            </p>
          </div>

          {currentCommandName && (
            <div className="rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20">
              <p className="text-sm text-yellow-800 dark:text-yellow-300">
                <strong>Current command:</strong> <code>/{currentCommandName}</code>
                <br />
                Installing a new command will remove the existing one.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Command Name *
            </label>
            <div className="mt-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  /
                </span>
                <input
                  type="text"
                  value={commandName}
                  onChange={(e) => handleCommandNameChange(e.target.value)}
                  placeholder="chat"
                  disabled={isLoading}
                  className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm disabled:bg-neutral-100 disabled:text-neutral-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-400"
                  autoFocus
                />
              </div>
              {validationError && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                  {validationError}
                </p>
              )}
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Must be 1-32 characters, lowercase letters, numbers, hyphens, and underscores only. Cannot start with a number.
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
            <h4 className="mb-2 text-sm font-semibold text-green-900 dark:text-green-200">
              How It Works
            </h4>
            <ol className="list-inside list-decimal space-y-1 text-sm text-green-800 dark:text-green-300">
              <li>After installation, the command will be available in Discord</li>
              <li>Users can type <code>/your-command-name message</code> to chat with your agent</li>
              <li>The command accepts a &quot;message&quot; parameter that gets sent to your AI agent</li>
              <li>You can update the command name at any time</li>
            </ol>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 rounded-md border border-neutral-300 px-4 py-2 font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isLoading || !commandName}
              className="flex-1 rounded-md bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading
                ? "Installing..."
                : currentCommandName
                  ? "Update Command"
                  : "Install Command"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

