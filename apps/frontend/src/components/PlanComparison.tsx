import type { FC } from "react";

import { useSubscriptionCheckout } from "../hooks/useSubscription";

type PlanKey = "free" | "starter" | "pro";

interface PlanComparisonProps {
  currentPlan: PlanKey;
  onUpgrade?: (plan: "starter" | "pro") => void;
  onDowngrade?: (plan: PlanKey) => void;
  isLoading?: boolean;
}

interface PlanLimits {
  maxWorkspaces: number;
  maxDocuments: number;
  maxDocumentSizeBytes: number;
  maxAgents: number;
  maxDailyRequests: number;
  maxUsers: number;
  maxManagers?: number;
  maxAgentKeys: number;
  maxChannels: number;
  maxMcpServers: number;
}

interface PlanSummary {
  name: string;
  plan: PlanKey;
  price: string;
  period: string;
  limits: PlanLimits;
  features: string[];
}

const BYTES_IN_MB = 1024 * 1024;

const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  free: {
    maxWorkspaces: 1,
    maxDocuments: 10,
    maxDocumentSizeBytes: 1 * BYTES_IN_MB,
    maxAgents: 1,
    maxDailyRequests: 25,
    maxUsers: 1,
    maxManagers: 1,
    maxAgentKeys: 5,
    maxChannels: 2,
    maxMcpServers: 2,
  },
  starter: {
    maxWorkspaces: 1,
    maxDocuments: 100,
    maxDocumentSizeBytes: 10 * BYTES_IN_MB,
    maxAgents: 5,
    maxDailyRequests: 3000,
    maxUsers: 1,
    maxManagers: 1,
    maxAgentKeys: 25,
    maxChannels: 10,
    maxMcpServers: 10,
  },
  pro: {
    maxWorkspaces: 5,
    maxDocuments: 1000,
    maxDocumentSizeBytes: 100 * BYTES_IN_MB,
    maxAgents: 50,
    maxDailyRequests: 10000,
    maxUsers: 5,
    maxAgentKeys: 250,
    maxChannels: 50,
    maxMcpServers: 50,
  },
};

const PLAN_SUMMARIES = [
  {
    name: "Free",
    plan: "free",
    price: "$0",
    period: "forever",
  },
  {
    name: "Starter",
    plan: "starter",
    price: "$29",
    period: "per month",
  },
  {
    name: "Pro",
    plan: "pro",
    price: "$99",
    period: "per month",
  },
] as const;

export const PlanComparison: FC<PlanComparisonProps> = (props) => {
  const {
    plans,
    isUpgradeLoading,
    isDowngradeLoading,
    handleUpgrade,
    handleDowngrade,
    hasDowngradeHandler,
  } = usePlanComparisonState(props);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {plans.map((plan) => (
        <PlanCard
          key={plan.plan}
          plan={plan}
          currentPlan={props.currentPlan}
          isUpgradeLoading={isUpgradeLoading}
          isDowngradeLoading={isDowngradeLoading}
          hasDowngradeHandler={hasDowngradeHandler}
          onUpgrade={handleUpgrade}
          onDowngrade={handleDowngrade}
        />
      ))}
    </div>
  );
};

interface PlanCardProps {
  plan: PlanSummary;
  currentPlan: PlanKey;
  isUpgradeLoading: boolean;
  isDowngradeLoading: boolean;
  hasDowngradeHandler: boolean;
  onUpgrade: (plan: "starter" | "pro") => void;
  onDowngrade: (plan: PlanKey) => void;
}

const PlanCard: FC<PlanCardProps> = ({
  plan,
  currentPlan,
  isUpgradeLoading,
  isDowngradeLoading,
  hasDowngradeHandler,
  onUpgrade,
  onDowngrade,
}) => {
  const isCurrent = plan.plan === currentPlan;
  const canUpgrade = canUpgradePlan(currentPlan, plan.plan);
  const canDowngrade = canDowngradePlan(currentPlan, plan.plan);

  return (
    <div
      className={`rounded-2xl border p-6 ${
        isCurrent
          ? "border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-950"
          : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-surface-50"
      }`}
    >
      <div className="mb-4">
        <h3 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          {plan.name}
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold text-neutral-900 dark:text-neutral-50">
            {plan.price}
          </span>
          <span className="text-neutral-600 dark:text-neutral-300">
            {plan.period}
          </span>
        </div>
        {isCurrent && (
          <span className="mt-2 inline-block rounded-full bg-primary-500 px-3 py-1 text-sm font-semibold text-white">
            Current Plan
          </span>
        )}
      </div>

      <FeatureList features={plan.features} />

      <PlanActions
        isCurrent={isCurrent}
        canUpgrade={canUpgrade}
        canDowngrade={canDowngrade}
        isUpgradeLoading={isUpgradeLoading}
        isDowngradeLoading={isDowngradeLoading}
        hasDowngradeHandler={hasDowngradeHandler}
        plan={plan.plan}
        onUpgrade={onUpgrade}
        onDowngrade={onDowngrade}
      />
    </div>
  );
};

interface FeatureListProps {
  features: string[];
}

const FeatureList: FC<FeatureListProps> = ({ features }) => (
  <ul className="mb-6 space-y-2">
    {features.map((feature) => (
      <li key={feature} className="flex items-start gap-2">
        <svg
          className="mt-0.5 size-5 flex-shrink-0 text-green-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
        <span className="text-neutral-700 dark:text-neutral-300">
          {feature}
        </span>
      </li>
    ))}
  </ul>
);

interface PlanActionsProps {
  isCurrent: boolean;
  canUpgrade: boolean;
  canDowngrade: boolean;
  isUpgradeLoading: boolean;
  isDowngradeLoading: boolean;
  hasDowngradeHandler: boolean;
  plan: PlanKey;
  onUpgrade: (plan: "starter" | "pro") => void;
  onDowngrade: (plan: PlanKey) => void;
}

const PlanActions: FC<PlanActionsProps> = ({
  isCurrent,
  canUpgrade,
  canDowngrade,
  isUpgradeLoading,
  isDowngradeLoading,
  hasDowngradeHandler,
  plan,
  onUpgrade,
  onDowngrade,
}) => {
  if (canUpgrade) {
    return (
      <button
        onClick={() => onUpgrade(plan as "starter" | "pro")}
        disabled={isUpgradeLoading}
        className="w-full rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isUpgradeLoading ? "Loading..." : "Upgrade"}
      </button>
    );
  }

  if (canDowngrade && hasDowngradeHandler) {
    return (
      <button
        onClick={() => onDowngrade(plan)}
        disabled={isDowngradeLoading}
        className="w-full rounded-xl border border-neutral-300 px-6 py-3 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-50 dark:hover:bg-neutral-800"
      >
        {isDowngradeLoading ? "Loading..." : "Downgrade"}
      </button>
    );
  }

  if (isCurrent) {
    return (
      <div className="py-3 text-center font-medium text-neutral-600 dark:text-neutral-300">
        Your current plan
      </div>
    );
  }

  return null;
};

function usePlanComparisonState({
  currentPlan,
  onUpgrade,
  onDowngrade,
  isLoading = false,
}: PlanComparisonProps) {
  const checkoutMutation = useSubscriptionCheckout();
  const isUpgradeLoading = onUpgrade ? isLoading : checkoutMutation.isPending;
  const isDowngradeLoading = onDowngrade ? isLoading : false;

  const handleUpgrade = (plan: "starter" | "pro") => {
    if (onUpgrade) {
      onUpgrade(plan);
      return;
    }
    checkoutMutation.mutate(plan);
  };

  const handleDowngrade = (plan: PlanKey) => {
    onDowngrade?.(plan);
  };

  const plans = PLAN_SUMMARIES.map((plan) => {
    const limits = PLAN_LIMITS[plan.plan];
    return {
      ...plan,
      limits,
      features: buildPlanFeatures(plan.plan, limits),
    };
  });

  return {
    currentPlan,
    plans,
    isUpgradeLoading,
    isDowngradeLoading,
    hasDowngradeHandler: Boolean(onDowngrade),
    handleUpgrade,
    handleDowngrade,
  };
}

function buildPlanFeatures(plan: PlanKey, limits: PlanLimits) {
  const storageMb = Math.floor(limits.maxDocumentSizeBytes / BYTES_IN_MB);
  const baseFeatures = [
    formatCountLabel(limits.maxWorkspaces, "workspace"),
    formatCountLabel(limits.maxDocuments, "document"),
    formatCountLabel(limits.maxAgents, "agent"),
    `${storageMb} MB storage`,
    `${limits.maxDailyRequests} requests/day`,
    formatCountLabel(limits.maxUsers, "team member", "team members"),
    plan === "pro"
      ? "Unlimited managers"
      : formatCountLabel(limits.maxManagers ?? 1, "manager"),
    formatCountLabel(limits.maxAgentKeys, "webhook"),
    formatCountLabel(limits.maxChannels, "channel"),
    formatCountLabel(limits.maxMcpServers, "connected tool"),
  ];

  if (plan === "free") {
    return [...baseFeatures, "10 web search/fetch calls/day"];
  }

  return [
    ...baseFeatures,
    "10 free web search/fetch calls/day, then $0.008/call",
    "Bring Your Own Key (BYOK)",
  ];
}

function formatCountLabel(
  count: number,
  singular: string,
  plural = `${singular}s`
) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function canUpgradePlan(currentPlan: PlanKey, plan: PlanKey) {
  return (
    (currentPlan === "free" && plan === "starter") ||
    (currentPlan === "free" && plan === "pro") ||
    (currentPlan === "starter" && plan === "pro")
  );
}

function canDowngradePlan(currentPlan: PlanKey, plan: PlanKey) {
  return (
    (currentPlan === "starter" && plan === "free") ||
    (currentPlan === "pro" && plan === "free") ||
    (currentPlan === "pro" && plan === "starter")
  );
}
