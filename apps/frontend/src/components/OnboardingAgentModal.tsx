import confetti from "canvas-confetti";
import { useState, useEffect, useRef } from "react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";

import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useImportWorkspace } from "../hooks/useWorkspaces";
import {
  postWorkspaceOnboardingAgent,
  type OnboardingAgentContext,
  type OnboardingAgentQuestion,
  type OnboardingAgentResultPayload,
  type WorkspaceExport,
} from "../utils/api";
import { formatCurrency } from "../utils/currency";
import { trackEvent } from "../utils/tracking";

const GOAL_OPTIONS = [
  { value: "personal", label: "Automate personal tasks" },
  { value: "business", label: "Run a small business" },
  { value: "support", label: "Customer support" },
  { value: "team", label: "Internal team assistant" },
  { value: "other", label: "Other" },
] as const;

function buildCreationNotes(
  goals: string[],
  intent: OnboardingAgentContext["intent"],
  summary: string,
): string {
  const lines: string[] = [];
  if (goals.length > 0) {
    const labels = goals.map(
      (g) => GOAL_OPTIONS.find((o) => o.value === g)?.label ?? g
    );
    lines.push(`Goals: ${labels.join("; ")}`);
  }
  const intentObj = intent ?? {};
  const freeText = "freeText" in intentObj ? intentObj.freeText : undefined;
  if (typeof freeText === "string" && freeText.trim())
    lines.push(`Free text: ${freeText.trim()}`);
  const skipKeys = new Set(["goals", "freeText", "goal"]);
  const answers = Object.entries(intentObj).filter(
    ([k, v]) =>
      !skipKeys.has(k) &&
      v !== undefined &&
      v !== "" &&
      (Array.isArray(v) ? v.length > 0 : true)
  );
  if (answers.length > 0) {
    lines.push(
      `Answers: ${answers
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(", ") : String(v)}`)
        .join(", ")}`
    );
  }
  if (summary.trim()) lines.push(`Summary: ${summary.trim()}`);
  return lines.join("\n");
}

function getRecommendations(
  goals: string[],
  template: WorkspaceExport | null
): string[] {
  const recs: string[] = [];
  recs.push("Open your agent to test a conversation or refine the system prompt.");
  if (goals.includes("personal")) {
    recs.push("Try the Test Agent on the agent page for a quick conversation.");
  }
  if (goals.includes("business")) {
    recs.push("Review spending limits in Workspace settings if you need to adjust caps.");
  }
  if (goals.includes("support")) {
    recs.push("Test your channels — send a message to see your agent respond.");
  }
  if (goals.includes("team")) {
    recs.push("Invite team members from Workspace settings so others can use the agents.");
  }
  if (template?.agents?.some((a) => (a.keys?.length ?? 0) > 0)) {
    recs.push("Your webhook URL is ready — open an agent and go to Keys to copy it.");
  }
  if (
    (template?.outputChannels?.length ?? 0) > 0 ||
    (template?.botIntegrations?.length ?? 0) > 0
  ) {
    recs.push("Channels are connected — try sending a message to test the integration.");
  }
  if (
    (template?.spendingLimits?.length ?? 0) > 0 ||
    template?.agents?.some((a) => (a.spendingLimits?.length ?? 0) > 0)
  ) {
    recs.push("Spending limits are set; you can adjust them in Workspace or agent settings.");
  }
  if ((template?.mcpServers?.length ?? 0) > 0) {
    recs.push("Connect your MCP servers in Integrations and enable them on the agent.");
  }
  if (template?.agents?.some((a) => a.enableSearchDocuments)) {
    recs.push("Upload documents in the agent's Documents section to enable search.");
  }
  if (template?.agents?.some((a) => a.memoryExtractionEnabled)) {
    recs.push("Memory extraction is on — long conversations will be summarized into memory.");
  }
  return recs.slice(0, 6);
}

interface OnboardingAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSkipToSimpleCreate: () => void;
}

type Step = "intent" | "questions" | "template" | "validation_failed" | "created";

export const OnboardingAgentModal: FC<OnboardingAgentModalProps> = ({
  isOpen,
  onClose,
  onSkipToSimpleCreate,
}) => {
  const navigate = useNavigate();
  const importWorkspace = useImportWorkspace();
  const { registerDialog, unregisterDialog } = useDialogTracking();

  const [step, setStep] = useState<Step>("intent");
  const [goals, setGoals] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const [intent, setIntent] = useState<OnboardingAgentContext["intent"]>({});
  const [questions, setQuestions] = useState<OnboardingAgentQuestion[]>([]);
  const [template, setTemplate] = useState<WorkspaceExport | null>(null);
  const [summary, setSummary] = useState("");
  const [refineInput, setRefineInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [createdWorkspace, setCreatedWorkspace] = useState<{ id: string; name: string } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleClose = () => {
    setStep("intent");
    setGoals([]);
    setFreeText("");
    setIntent({});
    setQuestions([]);
    setTemplate(null);
    setSummary("");
    setRefineInput("");
    setValidationError(null);
    setCreatedWorkspace(null);
    onClose();
  };

  useEscapeKey(isOpen, handleClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  useEffect(() => {
    if (step !== "created") return;
    let cancelled = false;
    const duration = 2_000;
    const end = Date.now() + duration;
    const frame = (): void => {
      if (cancelled || Date.now() >= end) return;
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ["#6366f1", "#8b5cf6", "#a855f7", "#c084fc"],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ["#6366f1", "#8b5cf6", "#a855f7", "#c084fc"],
      });
      requestAnimationFrame(frame);
    };
    const t = setTimeout(frame, 100);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [step]);

  const callOnboardingAgent = async (ctx: OnboardingAgentContext) => {
    setIsLoading(true);
    setValidationError(null);
    try {
      const response = await postWorkspaceOnboardingAgent({
        onboardingContext: ctx,
      });
      if (!mountedRef.current) return;
      const ev = response.finalEvent;
      if (ev.type === "onboarding_agent_result") {
        const payload = ev.payload as OnboardingAgentResultPayload;
        if (payload.type === "questions") {
          setQuestions(payload.questions);
          setStep("questions");
        } else {
          setTemplate(payload.template);
          setSummary(payload.summary);
          setStep("template");
        }
      } else {
        setValidationError(ev.error);
        setStep("validation_failed");
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setValidationError(err instanceof Error ? err.message : "Something went wrong");
      setStep("validation_failed");
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const handleSubmitIntent = async (e: React.FormEvent) => {
    e.preventDefault();
    const intentPayload: OnboardingAgentContext["intent"] = {
      goals: goals.length > 0 ? goals : undefined,
      freeText: freeText.trim() || undefined,
      ...intent,
    };
    setIntent(intentPayload);
    await callOnboardingAgent({
      step: "intent",
      intent: intentPayload,
    });
  };

  const toggleGoal = (value: string) => {
    setGoals((prev) =>
      prev.includes(value) ? prev.filter((g) => g !== value) : [...prev, value]
    );
  };

  const handleSubmitQuestions = async (
    nextIntent: OnboardingAgentContext["intent"]
  ) => {
    setIntent(nextIntent);
    await callOnboardingAgent({
      step: "intent",
      intent: nextIntent,
    });
  };

  const handleRefine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refineInput.trim() || !template) return;
    const message = refineInput.trim();
    setRefineInput("");
    await callOnboardingAgent({
      step: "refine",
      template,
      chatMessage: message,
    });
  };

  const handleCreateWorkspace = async () => {
    if (!template) return;
    try {
      const creationNotes = buildCreationNotes(goals, intent, summary);
      const workspace = await importWorkspace.mutateAsync({
        exportData: template,
        creationNotes,
      });
      trackEvent("workspace_created", { workspace_id: workspace.id });
      setCreatedWorkspace({ id: workspace.id, name: workspace.name });
      setStep("created");
    } catch {
      // Toast from hook
    }
  };

  const handleGoToWorkspace = () => {
    if (createdWorkspace) {
      handleClose();
      navigate(`/workspaces/${createdWorkspace.id}`);
    }
  };

  const handleTryAgain = async () => {
    setValidationError(null);
    if (template) {
      setStep("template");
      await callOnboardingAgent({ step: "refine", template, chatMessage: "Please fix the template." });
    } else {
      setStep("intent");
      await callOnboardingAgent({
        step: "intent",
        intent: { ...intent, goals: goals.length > 0 ? goals : undefined, freeText: freeText || undefined },
      });
    }
  };

  if (!isOpen) return null;

  const isCreatedStep = step === "created";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border-2 border-neutral-300 bg-white shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between border-b border-neutral-200 p-6 dark:border-neutral-700">
          <h2 className="text-2xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">
            {isCreatedStep ? "Workspace created!" : "Guided workspace setup"}
          </h2>
          {!isCreatedStep && (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-xl border-2 border-neutral-300 bg-white px-4 py-2 font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50 dark:hover:bg-neutral-700"
            >
              Cancel
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {!isCreatedStep && (
            <button
              type="button"
              onClick={onSkipToSimpleCreate}
              className="mb-4 text-sm font-medium text-primary-600 underline hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
            >
              Create workspace without guided setup
            </button>
          )}

          {step === "intent" && (
            <form onSubmit={handleSubmitIntent} className="space-y-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  What do you want to do? (select all that apply)
                </label>
                <div className="flex flex-wrap gap-2">
                  {GOAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleGoal(opt.value)}
                      className={`rounded-xl border-2 px-4 py-2 text-sm font-semibold transition-colors ${
                        goals.includes(opt.value)
                          ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                          : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {goals.includes("other") && (
                <div>
                  <label htmlFor="freeText" className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    Describe in a few words
                  </label>
                  <input
                    id="freeText"
                    type="text"
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
                    placeholder="e.g. Automate my inbox"
                  />
                  {goals.includes("other") && !freeText.trim() && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      Please describe your goal when selecting &quot;Other&quot;.
                    </p>
                  )}
                </div>
              )}
              <button
                type="submit"
                disabled={
                  isLoading ||
                  (goals.length === 0 && !freeText.trim()) ||
                  (goals.includes("other") && !freeText.trim())
                }
                className="w-full rounded-xl bg-gradient-primary px-6 py-3 font-bold text-white transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? "Thinking…" : "Continue"}
              </button>
            </form>
          )}

          {step === "questions" && (
            <QuestionsStep
              questions={questions}
              onSubmit={handleSubmitQuestions}
              isLoading={isLoading}
              intent={intent}
              setIntent={setIntent}
            />
          )}

          {step === "template" && template && (
            <div className="space-y-4">
              {summary && (
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="font-semibold text-neutral-900 dark:text-neutral-50">Summary</p>
                  <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">{summary}</p>
                </div>
              )}

              <div className="space-y-3">
                <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  Workspace
                </p>
                <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="font-medium text-neutral-900 dark:text-neutral-50">{template.name}</p>
                  {template.description && (
                    <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                      {template.description}
                    </p>
                  )}
                  {(template.spendingLimits?.length ?? 0) > 0 && (
                    <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                      Spending limits:{" "}
                      {template.spendingLimits!
                        .map(
                          (l) =>
                            `${l.timeFrame} ${formatCurrency(l.amount, "usd")}`
                        )
                        .join(", ")}
                    </p>
                  )}
                </div>
              </div>

              {template.agents && template.agents.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                    Agents ({template.agents.length})
                  </p>
                  <ul className="space-y-2">
                    {template.agents.map((agent, idx) => {
                      const features: string[] = [];
                      if (agent.enableSearchDocuments) features.push("Documents");
                      if (agent.enableMemorySearch) features.push("Memory");
                      if (agent.enableKnowledgeInjection) features.push("Knowledge");
                      if (agent.memoryExtractionEnabled) features.push("Memory extraction");
                      if ((agent.evalJudges?.length ?? 0) > 0)
                        features.push(`${agent.evalJudges!.length} eval judge(s)`);
                      if ((agent.spendingLimits?.length ?? 0) > 0)
                        features.push("Spending limits");
                      return (
                        <li
                          key={agent.id ?? idx}
                          className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-800"
                        >
                          <p className="font-medium text-neutral-900 dark:text-neutral-50">
                            {agent.name}
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">
                            {agent.systemPrompt}
                          </p>
                          {features.length > 0 && (
                            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                              {features.join(" · ")}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {(template.outputChannels?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                    Channels ({template.outputChannels!.length})
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {template.outputChannels!.map((ch, idx) => (
                      <li
                        key={ch.id ?? idx}
                        className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm font-medium capitalize text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                      >
                        {ch.type}: {ch.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(template.emailConnections?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                    Email ({template.emailConnections!.length})
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {template.emailConnections!.map((conn, idx) => (
                      <li
                        key={conn.id ?? idx}
                        className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm capitalize text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                      >
                        {conn.type}: {conn.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(template.botIntegrations?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                    Bot integrations ({template.botIntegrations!.length})
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {template.botIntegrations!.map((bot, idx) => (
                      <li
                        key={bot.id ?? idx}
                        className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm capitalize text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                      >
                        {bot.type}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(template.mcpServers?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                    MCP servers ({template.mcpServers!.length})
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {template.mcpServers!.map((srv, idx) => (
                      <li
                        key={srv.id ?? idx}
                        className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                      >
                        {srv.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <form onSubmit={handleRefine} className="flex gap-2">
                <input
                  type="text"
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  placeholder="Ask for changes (e.g. Add a second agent for sales)"
                  className="flex-1 rounded-xl border-2 border-neutral-300 bg-white px-4 py-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
                />
                <button
                  type="submit"
                  disabled={isLoading || !refineInput.trim()}
                  className="rounded-xl bg-neutral-200 px-4 py-2 font-semibold text-neutral-800 hover:bg-neutral-300 disabled:opacity-50 dark:bg-neutral-700 dark:text-neutral-100 dark:hover:bg-neutral-600"
                >
                  ✨ Send
                </button>
              </form>
              <button
                type="button"
                onClick={handleCreateWorkspace}
                disabled={importWorkspace.isPending}
                className="w-full rounded-xl bg-gradient-primary px-6 py-3 font-bold text-white hover:opacity-95 disabled:opacity-50"
              >
                {importWorkspace.isPending ? "✨ Creating…" : "✨ Create workspace"}
              </button>
            </div>
          )}

          {step === "validation_failed" && (
            <div className="space-y-4">
              <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                <p className="font-semibold text-amber-800 dark:text-amber-200">Something went wrong</p>
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{validationError}</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleTryAgain}
                  disabled={isLoading}
                  className="flex-1 rounded-xl bg-gradient-primary px-4 py-3 font-bold text-white disabled:opacity-50"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onSkipToSimpleCreate}
                  className="flex-1 rounded-xl border-2 border-neutral-300 bg-white px-4 py-3 font-bold text-neutral-800 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  Create without guided setup
                </button>
              </div>
            </div>
          )}

          {step === "created" && createdWorkspace && (
            <div className="space-y-6">
              <div className="rounded-xl border-2 border-primary-200 bg-primary-50 p-5 dark:border-primary-800 dark:bg-primary-900/20">
                <p className="text-lg font-bold text-primary-900 dark:text-primary-100">
                  Congratulations! Your workspace &quot;{createdWorkspace.name}&quot; has been created.
                </p>
                <p className="mt-2 text-sm text-primary-800 dark:text-primary-200">
                  Here are some next steps based on your setup:
                </p>
              </div>
              <ul className="space-y-2">
                {getRecommendations(goals, template).map((rec, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-sm text-neutral-700 dark:text-neutral-300"
                  >
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-500 dark:bg-primary-400" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={handleGoToWorkspace}
                className="w-full rounded-xl bg-gradient-primary px-6 py-3 font-bold text-white hover:opacity-95"
              >
                Go to workspace
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Option text that should show a "please specify" text box when selected */
function isOtherSpecifyOption(opt: unknown): boolean {
  if (opt == null || typeof opt !== "string") return false;
  const o = opt.toLowerCase().trim();
  return (
    o.includes("other") &&
    (o.includes("specify") || o === "other" || o.includes("please specify"))
  );
}

const QuestionsStep: FC<{
  questions: OnboardingAgentQuestion[];
  onSubmit: (nextIntent: OnboardingAgentContext["intent"]) => void;
  isLoading: boolean;
  intent: OnboardingAgentContext["intent"];
  setIntent: (updater: (prev: OnboardingAgentContext["intent"]) => OnboardingAgentContext["intent"]) => void;
}> = ({ questions, onSubmit, isLoading, intent, setIntent }) => {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextIntent: OnboardingAgentContext["intent"] = { ...(intent ?? {}) };
    for (const q of questions) {
      const val = answers[q.id];
      if (val === undefined) continue;
      const otherText = answers[`${q.id}_other`];
      if (q.kind === "choice" && q.multiple) {
        const arr = Array.isArray(val) ? val : [val];
        nextIntent[q.id] = arr.map((x) =>
          isOtherSpecifyOption(x) && otherText ? `${x}: ${otherText}` : x
        );
      } else {
        nextIntent[q.id] =
          isOtherSpecifyOption(val) && otherText
            ? `${val}: ${otherText}`
            : val;
      }
    }
    setIntent(() => nextIntent);
    onSubmit(nextIntent);
  };

  const hasIncompleteOther = questions.some((q) => {
    const val = answers[q.id];
    if (val === undefined) return false;
    const rawOther = answers[`${q.id}_other`];
    const otherText = typeof rawOther === "string" ? rawOther.trim() : "";
    if (q.kind === "choice" && q.multiple) {
      const arr = Array.isArray(val) ? val : [val];
      return arr.some((opt) => isOtherSpecifyOption(opt)) && !otherText;
    }
    return isOtherSpecifyOption(val) && !otherText;
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {questions.map((q) => (
        <div key={q.id} className="space-y-2">
          <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            {q.label}
          </label>
          {q.kind === "choice" && q.options?.length ? (
            <>
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt) => {
                  const isMulti = q.multiple;
                  const selected = isMulti
                    ? (Array.isArray(answers[q.id])
                        ? (answers[q.id] as string[]).includes(opt)
                        : answers[q.id] === opt)
                    : answers[q.id] === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() =>
                        setAnswers((a) => {
                          if (isMulti) {
                            const prev = a[q.id];
                            const arr = Array.isArray(prev)
                              ? prev
                              : prev !== undefined
                                ? [prev]
                                : [];
                            const next = arr.includes(opt)
                              ? arr.filter((x) => x !== opt)
                              : [...arr, opt];
                            return { ...a, [q.id]: next };
                          }
                          return { ...a, [q.id]: opt };
                        })
                      }
                      className={`rounded-xl border-2 px-4 py-2 text-sm font-semibold ${
                        selected
                          ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                          : "border-neutral-300 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              {(() => {
                const val = answers[q.id];
                const showOther =
                  val !== undefined &&
                  (q.multiple
                    ? Array.isArray(val) && val.some(isOtherSpecifyOption)
                    : isOtherSpecifyOption(val));
                return showOther ? (
                  <div>
                    <label
                      htmlFor={`${q.id}-other`}
                      className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400"
                    >
                      Please specify
                    </label>
                    <input
                      id={`${q.id}-other`}
                      type="text"
                      value={
                      typeof answers[`${q.id}_other`] === "string"
                        ? answers[`${q.id}_other`]
                        : ""
                    }
                      onChange={(e) =>
                        setAnswers((a) => ({
                          ...a,
                          [`${q.id}_other`]: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
                      placeholder="Your answer"
                    />
                  </div>
                ) : null;
              })()}
            </>
          ) : (
            <input
              type="text"
              value={(typeof answers[q.id] === "string" ? answers[q.id] : "") ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50"
              placeholder="Your answer"
            />
          )}
        </div>
      ))}
      <button
        type="submit"
        disabled={isLoading || hasIncompleteOther}
        className="w-full rounded-xl bg-gradient-primary px-6 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? "Thinking…" : "Continue"}
      </button>
    </form>
  );
};
