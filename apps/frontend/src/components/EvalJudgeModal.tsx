import { useState, useEffect } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import {
  useCreateEvalJudge,
  useUpdateEvalJudge,
  useEvalJudge,
} from "../hooks/useEvalJudges";

interface EvalJudgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  agentId: string;
  judgeId?: string; // If provided, we're editing; otherwise, creating
}

export const EvalJudgeModal: FC<EvalJudgeModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  agentId,
  judgeId,
}) => {
  const isEditing = !!judgeId;
  const { data: judge } = useEvalJudge(
    workspaceId,
    agentId,
    judgeId || ""
  );
  const createJudge = useCreateEvalJudge(workspaceId, agentId);
  const updateJudge = useUpdateEvalJudge(workspaceId, agentId, judgeId || "");

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [provider] = useState<"openrouter">("openrouter"); // Only openrouter is supported
  const [modelName, setModelName] = useState("");
  const [evalPrompt, setEvalPrompt] = useState("");

  // Reset form when modal opens/closes or judge changes
  useEffect(() => {
    if (isOpen) {
      if (judge) {
        setName(judge.name);
        setEnabled(judge.enabled);
        // Provider is always "openrouter" - no need to set it
        setModelName(judge.modelName);
        setEvalPrompt(judge.evalPrompt);
      } else {
        setName("");
        setEnabled(true);
        setModelName("");
        setEvalPrompt("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, judge?.id]);

  const handleClose = () => {
    setName("");
    setEnabled(true);
    setModelName("");
    setEvalPrompt("");
    onClose();
  };

  const { registerDialog, unregisterDialog } = useDialogTracking();
  useEscapeKey(isOpen, handleClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !modelName.trim() || !evalPrompt.trim()) return;

    try {
      if (isEditing && judgeId) {
        await updateJudge.mutateAsync({
          name: name.trim(),
          enabled,
          provider,
          modelName: modelName.trim(),
          evalPrompt: evalPrompt.trim(),
        });
      } else {
        await createJudge.mutateAsync({
          name: name.trim(),
          enabled,
          provider,
          modelName: modelName.trim(),
          evalPrompt: evalPrompt.trim(),
        });
      }
      handleClose();
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const isPending = isEditing ? updateJudge.isPending : createJudge.isPending;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-8 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {isEditing ? "Edit Evaluation Judge" : "Create Evaluation Judge"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Name *
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="enabled"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500 dark:border-neutral-700"
            />
            <label
              htmlFor="enabled"
              className="text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Enabled
            </label>
          </div>

          <div>
            <label
              htmlFor="provider"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Provider
            </label>
            <input
              id="provider"
              type="text"
              value="OpenRouter"
              disabled
              className="w-full rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-2.5 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
            />
            <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              Only OpenRouter is supported for evaluation judges.
            </p>
          </div>

          <div>
            <label
              htmlFor="modelName"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Model Name *
            </label>
            <input
              id="modelName"
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              placeholder="e.g., gpt-4o, claude-3-5-sonnet-20241022"
              required
            />
            <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              The model name to use for evaluation (e.g., gpt-4o, claude-3-5-sonnet-20241022)
            </p>
          </div>

          <div>
            <label
              htmlFor="evalPrompt"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Evaluation Prompt *
            </label>
            <textarea
              id="evalPrompt"
              value={evalPrompt}
              onChange={(e) => setEvalPrompt(e.target.value)}
              rows={10}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-sm text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              placeholder="Enter the evaluation prompt template..."
              required
            />
            <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              The prompt template used to evaluate agent conversations. This will be used to assess goal completion, tool efficiency, and faithfulness.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending
                ? isEditing
                  ? "Updating..."
                  : "Creating..."
                : isEditing
                ? "Update"
                : "Create"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
