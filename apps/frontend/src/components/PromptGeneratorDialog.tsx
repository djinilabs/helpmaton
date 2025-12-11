import { useState } from "react";
import type { FC } from "react";

import { useGeneratePrompt } from "../hooks/useAgents";
import { useEscapeKey } from "../hooks/useEscapeKey";

import { LoadingScreen } from "./LoadingScreen";

interface PromptGeneratorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  agentId?: string | null;
  onAccept: (prompt: string) => void;
}

export const PromptGeneratorDialog: FC<PromptGeneratorDialogProps> = ({
  isOpen,
  onClose,
  workspaceId,
  agentId,
  onAccept,
}) => {
  const [goal, setGoal] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const generatePrompt = useGeneratePrompt(workspaceId);

  useEscapeKey(isOpen, onClose);

  const handleGenerate = async () => {
    if (!goal.trim()) return;

    try {
      const result = await generatePrompt.mutateAsync({
        goal: goal.trim(),
        agentId: agentId || undefined,
      });
      setGeneratedPrompt(result.prompt);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleAccept = () => {
    if (generatedPrompt) {
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white border border-neutral-200 rounded-2xl shadow-dramatic border-2 border-neutral-300 p-8 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-semibold text-neutral-900">
            Generate System Prompt
          </h2>
          <button
            onClick={handleClose}
            className="border border-neutral-300 bg-white px-6 py-2 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 transition-colors"
          >
            Close
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <label
              htmlFor="goal"
              className="block text-sm font-medium text-neutral-700 mb-2"
            >
              Describe your agent&apos;s goal
            </label>
            <textarea
              id="goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g., I want an agent that helps customers with technical support questions, provides clear explanations, and escalates complex issues to the engineering team."
              className="w-full border border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
              rows={4}
            />
            <p className="text-xs mt-1.5 text-neutral-600">
              Provide a description of what you want your agent to do. The more
              specific you are, the better the generated prompt will be.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!goal.trim() || generatePrompt.isPending}
              className="flex-1 bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generatePrompt.isPending ? "Generating..." : "Generate Prompt"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={generatePrompt.isPending}
              className="flex-1 border border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
          </div>

          {generatePrompt.isPending && (
            <div className="border border-neutral-200 rounded-lg p-6 bg-neutral-50">
              <LoadingScreen compact message="Generating your prompt..." />
            </div>
          )}

          {generatedPrompt && !generatePrompt.isPending && (
            <div className="space-y-4">
              <div className="border border-green-200 rounded-lg p-4 bg-green-50">
                <p className="text-sm font-semibold text-green-800 mb-2">
                  ✓ Prompt Generated
                </p>
                <p className="text-xs text-green-900">
                  Review the generated prompt below. You can use it as-is or
                  modify it before applying.
                </p>
              </div>

              <div>
                <label
                  htmlFor="generatedPrompt"
                  className="block text-sm font-medium text-neutral-700 mb-2"
                >
                  Generated System Prompt
                </label>
                <textarea
                  id="generatedPrompt"
                  value={generatedPrompt}
                  onChange={(e) => setGeneratedPrompt(e.target.value)}
                  className="w-full border border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors font-mono text-sm"
                  rows={12}
                />
                <p className="text-xs mt-1.5 text-neutral-600">
                  You can edit the generated prompt before using it.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleAccept}
                  className="flex-1 bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored transition-colors"
                >
                  Use This Prompt
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 border border-neutral-300 bg-white px-4 py-2.5 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {generatePrompt.isError && !generatePrompt.isPending && (
            <div className="border border-red-200 rounded-lg p-4 bg-red-50">
              <p className="text-sm font-semibold text-red-800 mb-1">
                Error generating prompt
              </p>
              <p className="text-xs text-red-900">
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
