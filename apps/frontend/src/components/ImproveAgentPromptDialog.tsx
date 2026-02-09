import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect, useRef } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useImproveAgentPrompt, useUpdateAgent } from "../hooks/useAgents";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useAgentEvalResults } from "../hooks/useEvalJudges";
import type { EvalResult, EvalResultsResponse } from "../utils/api";
import { getAvailableModels } from "../utils/api";
import {
  filterTextGenerationModels,
  resolveDefaultModel,
} from "../utils/modelConfig";

import { LoadingScreen } from "./LoadingScreen";
import { ScrollContainer } from "./ScrollContainer";
import { VirtualList } from "./VirtualList";

const DEFAULT_USER_PROMPT = `Update the system prompt based on the selected evaluation results.

- Address recurring low scores or critical failures.
- Preserve important constraints and safety requirements.
- Keep the prompt clear, specific, and actionable.

Return only the revised system prompt text.`;

type ImproveAgentPromptDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  agentId: string;
};

const buildEvalKey = (result: Pick<EvalResult, "conversationId" | "judgeId">) =>
  `${result.conversationId}:${result.judgeId}`;

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleString();
};

export const ImproveAgentPromptDialog: FC<ImproveAgentPromptDialogProps> = ({
  isOpen,
  onClose,
  workspaceId,
  agentId,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedEvalKeys, setSelectedEvalKeys] = useState<Set<string>>(
    new Set()
  );
  const [userPrompt, setUserPrompt] = useState(DEFAULT_USER_PROMPT);
  const [modelName, setModelName] = useState<string>("");
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { registerDialog, unregisterDialog } = useDialogTracking();

  const improvePrompt = useImproveAgentPrompt(workspaceId, agentId);
  const updateAgent = useUpdateAgent(workspaceId, agentId);

  const {
    data: evalData,
    isLoading: isLoadingEvals,
    error: evalsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAgentEvalResults(
    workspaceId,
    agentId,
    undefined,
    50,
    {
      enabled: isOpen,
    }
  );

  const { data: modelsData, isLoading: isLoadingModels } = useQuery({
    queryKey: ["availableModels"],
    queryFn: getAvailableModels,
    enabled: isOpen,
  });

  const allResults = useMemo(() => {
    if (!evalData) {
      return [] as EvalResult[];
    }
    return (
      (evalData as unknown as { pages: EvalResultsResponse[] }).pages ?? []
    ).flatMap((page) => page.results);
  }, [evalData]);

  const sortedResults = useMemo(() => {
    return [...allResults].sort(
      (a, b) =>
        new Date(b.evaluatedAt).getTime() -
        new Date(a.evaluatedAt).getTime()
    );
  }, [allResults]);

  const availableModels = useMemo(() => {
    const openrouterModels = modelsData?.openrouter?.models ?? [];
    const capabilities = modelsData?.openrouter?.capabilities;
    const textModels = filterTextGenerationModels(
      openrouterModels,
      capabilities
    );
    return textModels.length > 0 ? textModels : openrouterModels;
  }, [modelsData]);

  const defaultModel = useMemo(() => {
    if (!modelsData?.openrouter?.defaultModel) {
      return resolveDefaultModel(availableModels, "");
    }
    return resolveDefaultModel(
      availableModels,
      modelsData.openrouter.defaultModel
    );
  }, [availableModels, modelsData]);

  const effectiveModelName = modelName || defaultModel;

  const selectedEvaluations = useMemo(() => {
    return sortedResults.filter((result) =>
      selectedEvalKeys.has(buildEvalKey(result))
    );
  }, [sortedResults, selectedEvalKeys]);

  const handleClose = () => {
    setStep(1);
    setSelectedEvalKeys(new Set());
    setUserPrompt(DEFAULT_USER_PROMPT);
    setModelName("");
    setGeneratedPrompt(null);
    onClose();
  };

  useEscapeKey(isOpen, () => handleClose());

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const toggleEvaluation = (result: EvalResult) => {
    const key = buildEvalKey(result);
    setSelectedEvalKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!userPrompt.trim() || selectedEvaluations.length === 0) {
      return;
    }
    try {
      const result = await improvePrompt.mutateAsync({
        userPrompt: userPrompt.trim(),
        modelName: effectiveModelName || null,
        selectedEvaluations: selectedEvaluations.map((evaluation) => ({
          conversationId: evaluation.conversationId,
          judgeId: evaluation.judgeId,
        })),
      });
      setGeneratedPrompt(result.prompt);
      setStep(3);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleSave = async () => {
    if (!generatedPrompt) {
      return;
    }
    try {
      await updateAgent.mutateAsync({
        systemPrompt: generatedPrompt,
      });
      handleClose();
    } catch {
      // Error is handled by toast in the hook
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-surface-50">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-50">
              ✨ Improve Agent Prompt
            </h2>
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
              Step {step} of 3
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-xl border border-neutral-300 bg-white px-6 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            Close
          </button>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                Select evaluations to include
              </div>
              <div className="text-xs text-neutral-600 dark:text-neutral-400">
                Selected: {selectedEvaluations.length}
              </div>
            </div>

            {isLoadingEvals && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6 dark:border-neutral-700 dark:bg-surface-100">
                <LoadingScreen compact message="Loading evaluations..." />
              </div>
            )}

            {evalsError && !isLoadingEvals && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                  Failed to load evaluations
                </p>
              </div>
            )}

            {!isLoadingEvals && !evalsError && sortedResults.length === 0 && (
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                No evaluation results yet.
              </p>
            )}

            {!isLoadingEvals && !evalsError && sortedResults.length > 0 && (
              <ScrollContainer
                ref={scrollRef}
                maxHeight="min(70vh, 400px)"
                className="mb-4"
              >
                <VirtualList<EvalResult>
                  scrollRef={scrollRef}
                  items={sortedResults}
                  estimateSize={() => 100}
                  getItemKey={(_, r) => buildEvalKey(r)}
                  hasNextPage={hasNextPage}
                  isFetchingNextPage={isFetchingNextPage}
                  fetchNextPage={fetchNextPage}
                  renderRow={(result) => {
                    const key = buildEvalKey(result);
                    const isSelected = selectedEvalKeys.has(key);
                    return (
                      <div className="mb-2">
                        <label
                          className="flex cursor-pointer items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:hover:bg-neutral-800"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleEvaluation(result)}
                            className="mt-1 rounded border-2 border-neutral-300"
                          />
                          <div className="flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                              <span>{result.judgeName}</span>
                              <span className="text-xs font-normal text-neutral-500">
                                {formatDate(result.evaluatedAt)}
                              </span>
                              {result.criticalFailureDetected && (
                                <span className="rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                                  Critical failure
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-neutral-600 dark:text-neutral-300">
                              {result.summary || "No summary available"}
                            </p>
                            <div className="flex flex-wrap gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                              <span>Goal: {result.scoreGoalCompletion ?? "N/A"}</span>
                              <span>
                                Tool: {result.scoreToolEfficiency ?? "N/A"}
                              </span>
                              <span>
                                Faithfulness: {result.scoreFaithfulness ?? "N/A"}
                              </span>
                            </div>
                          </div>
                        </label>
                      </div>
                    );
                  }}
                />
              </ScrollContainer>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={selectedEvaluations.length === 0}
                className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue
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

        {step === 2 && (
          <div className="space-y-6">
            <div>
              <label
                htmlFor="improveModel"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Recommendation model
              </label>
              <select
                id="improveModel"
                value={effectiveModelName}
                disabled={isLoadingModels}
                onChange={(e) => setModelName(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-blue-400 dark:focus:ring-blue-400/40"
              >
                {isLoadingModels ? (
                  <option value="">Loading models...</option>
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
              {defaultModel && (
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  Default: {defaultModel}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="userPrompt"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Instructions for the recommendation
              </label>
              <textarea
                id="userPrompt"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                rows={6}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-blue-400 dark:focus:ring-blue-400/40"
              />
              <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                This will be sent with the selected evaluation results and the
                current system prompt.
              </p>
            </div>

            {improvePrompt.isPending && (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-6 dark:border-neutral-700 dark:bg-surface-100">
                <LoadingScreen compact message="Generating recommendation..." />
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={
                  improvePrompt.isPending ||
                  !userPrompt.trim() ||
                  selectedEvaluations.length === 0
                }
                className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
              >
                {improvePrompt.isPending ? "✨ Generating..." : "✨ Generate Prompt"}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <label
                htmlFor="generatedPrompt"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Improved system prompt
              </label>
              <textarea
                id="generatedPrompt"
                value={generatedPrompt ?? ""}
                onChange={(e) => setGeneratedPrompt(e.target.value)}
                rows={12}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-sm text-neutral-900 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-blue-400 dark:focus:ring-blue-400/40"
              />
              <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                Review and edit before saving.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={updateAgent.isPending || !generatedPrompt?.trim()}
                className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updateAgent.isPending ? "Saving..." : "Save Prompt"}
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
      </div>
    </div>
  );
};
