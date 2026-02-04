import { useState, useEffect, lazy, Suspense } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import {
  useCreateEvalJudge,
  useUpdateEvalJudge,
  useEvalJudge,
} from "../hooks/useEvalJudges";
import type { ModelCapabilities } from "../utils/api";
import {
  filterTextGenerationModels,
  getCapabilitiesForProvider,
  getCapabilityLabels,
  getModelCapabilities,
  getModelsForProvider,
  getDefaultModelForProvider,
  resolveDefaultModel,
} from "../utils/modelConfig";

const ModelPricesDialog = lazy(() =>
  import("./ModelPricesDialog").then((module) => ({
    default: module.ModelPricesDialog,
  }))
);

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
  const [samplingProbability, setSamplingProbability] = useState(100);
  const provider = "openrouter" as const; // Only openrouter is supported
  const [modelName, setModelName] = useState<string | null>(null);
  
  // Default evaluation prompt template
  const defaultEvalPrompt = `You are an AI Agent Auditor. Your job is to objectively evaluate the performance of an AI Agent based on its execution trace.

The agent's goal is: {agent_goal}

You will be provided with a JSON object containing:
1. "input_prompt": The user's original request.
2. "steps": A chronological list of thoughts, tool calls, and tool results.
3. "final_response": The final answer given to the user.

### YOUR GOAL
Analyze the trace and generate a JSON evaluation report. You must assess the agent on three specific metrics:

1. GOAL COMPLETION (0-100)
   - Did the agent strictly answer the user's request?
   - Did it ignore any constraints (e.g., "answer in JSON only")?
   - If the agent encountered an error, did it gracefully handle it or just give up?

2. TOOL EFFICIENCY (0-100)
   - Did the agent choose the correct tools for the task?
   - Did the agent get stuck in a loop (repeating the same tool call with the same inputs)?
   - Did the agent hallucinate tool parameters (inputs that don't make sense)?

3. FAITHFULNESS (0-100)
   - Is the "final_response" supported by the data found in "tool_result"?
   - Did the agent make up facts not present in the tool outputs? (Critical failure).

### ANALYSIS RULES
- If a tool fails (returns error), but the agent recovers and finds another way, do not penalize heavily.
- If the agent repeats the exact same step 3+ times, Tool Efficiency is 0.
- If the final answer contains numbers or facts not found in the step history, Faithfulness is 0.

### OUTPUT FORMAT
You must respond with valid JSON only. Do not include markdown formatting like \`\`\`json, any prose, or extra text before/after the JSON. Structure your response as follows:
{
  "summary": "A 1-sentence summary of the run.",
  "score_goal_completion": <int 0-100>,
  "score_tool_efficiency": <int 0-100>,
  "score_faithfulness": <int 0-100>,
  "critical_failure_detected": <boolean>,
  "reasoning_trace": "Explain your scoring logic here. Cite specific step_ids if relevant."
}`;

  const [evalPrompt, setEvalPrompt] = useState(defaultEvalPrompt);
  const [isModelPricesOpen, setIsModelPricesOpen] = useState(false);
  const [modelCapabilities, setModelCapabilities] = useState<
    Record<string, ModelCapabilities> | undefined
  >(undefined);

  // Model fetching state
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>("");
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);

  // Fetch models on mount and when modal opens
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    async function loadModels() {
      setIsLoadingModels(true);
      try {
        const [models, defaultModelName, capabilities] = await Promise.all([
          getModelsForProvider(provider),
          getDefaultModelForProvider(provider),
          getCapabilitiesForProvider(provider),
        ]);
        const filteredModels = filterTextGenerationModels(models, capabilities);
        const resolvedModels =
          filteredModels.length > 0 ? filteredModels : models;
        const resolvedDefaultModel = resolveDefaultModel(
          resolvedModels,
          defaultModelName
        );
        if (!cancelled) {
          setAvailableModels(resolvedModels);
          setDefaultModel(resolvedDefaultModel);
          setModelCapabilities(capabilities);
          setModelName((current) =>
            current && !resolvedModels.includes(current)
              ? null
              : current
          );
        }
      } catch (error) {
        console.error("Failed to load models:", error);
        if (!cancelled) {
          setAvailableModels([]);
          setDefaultModel("");
          setModelCapabilities(undefined);
          setModelLoadError(
            "Failed to load available models. Please refresh the page."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingModels(false);
        }
      }
    }

    loadModels();

    return () => {
      cancelled = true;
    };
  }, [isOpen, provider]);

  // Reset form when modal opens/closes or judge changes
  useEffect(() => {
    if (isOpen) {
      if (judge) {
        setName(judge.name);
        setEnabled(judge.enabled);
        setSamplingProbability(judge.samplingProbability ?? 100);
        // Provider is always "openrouter" - no need to set it
        setModelName(judge.modelName || null);
        setEvalPrompt(judge.evalPrompt);
      } else {
        setName("");
        setEnabled(true);
        setSamplingProbability(100);
        setModelName(null);
        setEvalPrompt(defaultEvalPrompt);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, judge?.id]);

  const handleClose = () => {
    setName("");
    setEnabled(true);
    setSamplingProbability(100);
    setModelName(null);
    setEvalPrompt(defaultEvalPrompt);
    setIsModelPricesOpen(false);
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
    const finalModelName = modelName || defaultModel;
    if (!name.trim() || !finalModelName || !evalPrompt.trim()) return;

    try {
      if (isEditing && judgeId) {
        await updateJudge.mutateAsync({
          name: name.trim(),
          enabled,
          samplingProbability,
          provider,
          modelName: finalModelName,
          evalPrompt: evalPrompt.trim(),
        });
      } else {
        await createJudge.mutateAsync({
          name: name.trim(),
          enabled,
          samplingProbability,
          provider,
          modelName: finalModelName,
          evalPrompt: evalPrompt.trim(),
        });
      }
      handleClose();
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const isPending = isEditing ? updateJudge.isPending : createJudge.isPending;
  const selectedModelName = modelName || defaultModel;
  const selectedCapabilities = getModelCapabilities(
    modelCapabilities,
    selectedModelName
  );
  const capabilityLabels = getCapabilityLabels(selectedCapabilities);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-8 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {isEditing ? "Edit Evaluation Judge" : "✨ Create Evaluation Judge"}
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
              htmlFor="samplingProbability"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Sampling Probability ({samplingProbability}%)
            </label>
            <input
              id="samplingProbability"
              type="range"
              min={0}
              max={100}
              step={1}
              value={samplingProbability}
              onChange={(e) =>
                setSamplingProbability(Number.parseInt(e.target.value, 10))
              }
              className="w-full accent-primary-500"
            />
            <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              Controls how often this judge evaluates conversations (0–100%).
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-2">
              <label
                htmlFor="modelName"
                className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Model Name *
              </label>
              <button
                type="button"
                onClick={() => setIsModelPricesOpen(true)}
                className="rounded-lg border-2 border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                💰 Model prices
              </button>
            </div>
            <select
              id="modelName"
              disabled={isLoadingModels}
              value={isLoadingModels ? "" : modelName || defaultModel}
              onChange={(e) => {
                const selectedModel = e.target.value;
                setModelName(
                  selectedModel === defaultModel ? null : selectedModel
                );
              }}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
            >
              {isLoadingModels ? (
                <option value="">Loading...</option>
              ) : availableModels.length === 0 ? (
                <option value="">No models available</option>
              ) : (
                availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))
              )}
            </select>
            {modelLoadError && (
              <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
                {modelLoadError}
              </p>
            )}
            {!modelLoadError && (
              <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                {modelName || defaultModel
                  ? `Selected: ${modelName || defaultModel}`
                  : "Select a model to use for evaluation"}
              </p>
            )}
            {!modelLoadError && (
              <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                {capabilityLabels.length > 0
                  ? `Capabilities: ${capabilityLabels.join(", ")}`
                  : "Capabilities: unavailable"}
              </p>
            )}
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
                  : "✨ Creating..."
                : isEditing
                ? "Update"
                : "✨ Create"}
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

        {/* Model Prices Dialog */}
        {isModelPricesOpen && (
          <Suspense fallback={null}>
            <ModelPricesDialog
              isOpen={isModelPricesOpen}
              onClose={() => setIsModelPricesOpen(false)}
              capabilityFilter="text_generation"
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};
