import { useState, useEffect } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useGeneratePrompt } from "../hooks/useAgents";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { trackEvent } from "../utils/tracking";

import { LoadingScreen } from "./LoadingScreen";

interface PromptGeneratorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  agentId?: string | null;
  hasExistingPrompt?: boolean;
  onAccept: (prompt: string) => void;
}

export const PromptGeneratorDialog: FC<PromptGeneratorDialogProps> = ({
  isOpen,
  onClose,
  workspaceId,
  agentId,
  hasExistingPrompt = false,
  onAccept,
}) => {
  const [goal, setGoal] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const generatePrompt = useGeneratePrompt(workspaceId);
  const { registerDialog, unregisterDialog } = useDialogTracking();

  useEscapeKey(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const handleGenerate = async () => {
    if (!goal.trim()) return;

    try {
      const result = await generatePrompt.mutateAsync({
        goal: goal.trim(),
        agentId: agentId || undefined,
      });
      trackEvent("agent_prompt_generated", {
        workspace_id: workspaceId,
        agent_id: agentId || undefined,
      });
      setGeneratedPrompt(result.prompt);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleAccept = () => {
    if (generatedPrompt) {
      trackEvent("agent_prompt_accepted", {
        workspace_id: workspaceId,
        agent_id: agentId || undefined,
      });
      onAccept(generatedPrompt);
      handleClose();
    }
  };

  const handleClose = () => {
    setGoal("");
    setGeneratedPrompt(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-surface-50">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50">
            {hasExistingPrompt ? "Improve System Prompt" : "Generate System Prompt"}
          </h2>
          <button
            onClick={handleClose}
            className="rounded-xl border border-neutral-300 bg-white px-6 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            Close
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <label
              htmlFor="goal"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              {hasExistingPrompt
                ? "Describe how you want to improve your agent"
                : "Describe your agent&apos;s goal"}
            </label>
            <textarea
              id="goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={
                hasExistingPrompt
                  ? "e.g., Make the agent more friendly and conversational, or add instructions to handle refund requests."
                  : "e.g., I want an agent that helps customers with technical support questions, provides clear explanations, and escalates complex issues to the engineering team."
              }
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:ring-primary-400"
              rows={4}
            />
            <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              {hasExistingPrompt
                ? "Describe how you want to improve or modify your agent's system prompt. The AI will build upon your existing prompt based on your request."
                : "Provide a description of what you want your agent to do. The more specific you are, the better the generated prompt will be."}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!goal.trim() || generatePrompt.isPending}
              className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generatePrompt.isPending ? "✨ Generating..." : "✨ Generate Prompt"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={generatePrompt.isPending}
              className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>

          {generatePrompt.isPending && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6 dark:border-neutral-700 dark:bg-surface-100">
              <LoadingScreen compact message="Generating your prompt..." />
            </div>
          )}

          {generatedPrompt && !generatePrompt.isPending && (
            <div className="space-y-4">
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
                <p className="mb-2 text-sm font-semibold text-green-800 dark:text-green-200">
                  ✓ {hasExistingPrompt ? "Prompt Improved" : "Prompt Generated"}
                </p>
                <p className="text-xs text-green-900 dark:text-green-100">
                  {hasExistingPrompt
                    ? "Review the improved prompt below. It has been modified based on your request. You can use it as-is or make further edits before applying."
                    : "Review the generated prompt below. You can use it as-is or modify it before applying."}
                </p>
              </div>

              <div>
                <label
                  htmlFor="generatedPrompt"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Generated System Prompt
                </label>
                <textarea
                  id="generatedPrompt"
                  value={generatedPrompt}
                  onChange={(e) => setGeneratedPrompt(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-sm text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:ring-primary-400"
                  rows={12}
                />
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  You can edit the generated prompt before using it.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleAccept}
                  className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored"
                >
                  Use This Prompt
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {generatePrompt.isError && !generatePrompt.isPending && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <p className="mb-1 text-sm font-semibold text-red-800 dark:text-red-200">
                Error generating prompt
              </p>
              <p className="text-xs text-red-900 dark:text-red-100">
                {generatePrompt.error instanceof Error
                  ? generatePrompt.error.message
                  : "An error occurred while generating the prompt. Please try again."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
