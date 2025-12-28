import type { FC } from "react";

import { useSubscriptionCheckout } from "../hooks/useSubscription";

interface PlanComparisonProps {
  currentPlan: "free" | "starter" | "pro";
  onUpgrade?: (plan: "starter" | "pro") => void;
  onDowngrade?: (plan: "free" | "starter" | "pro") => void;
  isLoading?: boolean;
}

export const PlanComparison: FC<PlanComparisonProps> = ({
  currentPlan,
  onUpgrade,
  onDowngrade,
  isLoading = false,
}) => {
  const checkoutMutation = useSubscriptionCheckout();
  // If onUpgrade/onDowngrade are provided, use the external loading state
  // Otherwise, use the internal checkoutMutation loading state
  const isUpgradeLoading = onUpgrade ? isLoading : checkoutMutation.isPending;
  const isDowngradeLoading = onDowngrade ? isLoading : false;

  const handleUpgrade = (plan: "starter" | "pro") => {
    if (onUpgrade) {
      onUpgrade(plan);
    } else {
      checkoutMutation.mutate(plan);
    }
  };

  const freeLimits = getPlanLimits("free");
  const starterLimits = getPlanLimits("starter");
  const proLimits = getPlanLimits("pro");

  const plans = [
    {
      name: "Free",
      plan: "free" as const,
      price: "$0",
      period: "forever",
      limits: freeLimits,
      features: [
        `${freeLimits?.maxWorkspaces || 1} workspace`,
        `${freeLimits?.maxDocuments || 10} documents`,
        `${freeLimits?.maxAgents || 1} agent`,
        `${(freeLimits?.maxDocumentSizeBytes || 0) / (1024 * 1024)} MB storage`,
        `${freeLimits?.maxDailyRequests || 0} requests/day`,
        `${freeLimits?.maxUsers || 1} team member`,
        `${freeLimits?.maxManagers || 1} manager`,
        `${freeLimits?.maxAgentKeys || 5} webhooks`,
        `${freeLimits?.maxChannels || 2} channels`,
        `${freeLimits?.maxMcpServers || 2} MCP servers`,
        "10 web search/fetch calls/day",
      ],
    },
    {
      name: "Starter",
      plan: "starter" as const,
      price: "$29",
      period: "per month",
      limits: starterLimits,
      features: [
        `${starterLimits?.maxWorkspaces || 1} workspace`,
        `${starterLimits?.maxDocuments || 100} documents`,
        `${starterLimits?.maxAgents || 5} agents`,
        `${
          (starterLimits?.maxDocumentSizeBytes || 0) / (1024 * 1024)
        } MB storage`,
        `${starterLimits?.maxDailyRequests || 0} requests/day`,
        `${starterLimits?.maxUsers || 1} team member`,
        `${starterLimits?.maxManagers || 1} manager`,
        `${starterLimits?.maxAgentKeys || 25} webhooks`,
        `${starterLimits?.maxChannels || 10} channels`,
        `${starterLimits?.maxMcpServers || 10} MCP servers`,
        "10 free web search/fetch calls/day, then $0.008/call",
        "Bring Your Own Key (BYOK)",
      ],
    },
    {
      name: "Pro",
      plan: "pro" as const,
      price: "$99",
      period: "per month",
      limits: proLimits,
      features: [
        `${proLimits?.maxWorkspaces || 5} workspaces`,
        `${proLimits?.maxDocuments || 1000} documents`,
        `${proLimits?.maxAgents || 50} agents`,
        `${(proLimits?.maxDocumentSizeBytes || 0) / (1024 * 1024)} MB storage`,
        `${proLimits?.maxDailyRequests || 0} requests/day`,
        `${proLimits?.maxUsers || 5} team members`,
        "Unlimited managers",
        `${proLimits?.maxAgentKeys || 250} webhooks`,
        `${proLimits?.maxChannels || 50} channels`,
        `${proLimits?.maxMcpServers || 50} MCP servers`,
        "10 free web search/fetch calls/day, then $0.008/call",
        "Bring Your Own Key (BYOK)",
      ],
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {plans.map((plan) => {
        const isCurrent = plan.plan === currentPlan;
        const canUpgrade =
          (currentPlan === "free" && plan.plan === "starter") ||
          (currentPlan === "free" && plan.plan === "pro") ||
          (currentPlan === "starter" && plan.plan === "pro");
        const canDowngrade =
          (currentPlan === "starter" && plan.plan === "free") ||
          (currentPlan === "pro" && plan.plan === "free") ||
          (currentPlan === "pro" && plan.plan === "starter");

        return (
          <div
            key={plan.plan}
            className={`rounded-2xl border p-6 ${
              isCurrent
                ? "border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-950"
                : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
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

            <ul className="mb-6 space-y-2">
              {plan.features.map((feature, index) => (
                <li key={index} className="flex items-start gap-2">
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

            {canUpgrade && (
              <button
                onClick={() => handleUpgrade(plan.plan)}
                disabled={isUpgradeLoading}
                className="w-full rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isUpgradeLoading ? "Loading..." : "Upgrade"}
              </button>
            )}

            {canDowngrade && onDowngrade && (
              <button
                onClick={() => onDowngrade(plan.plan)}
                disabled={isDowngradeLoading}
                className="w-full rounded-xl border border-neutral-300 px-6 py-3 font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                {isDowngradeLoading ? "Loading..." : "Downgrade"}
              </button>
            )}

            {isCurrent && !canUpgrade && !canDowngrade && (
              <div className="py-3 text-center font-medium text-neutral-600 dark:text-neutral-300">
                Your current plan
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Helper function to get plan limits (matching backend structure)
function getPlanLimits(plan: "free" | "starter" | "pro") {
  const limits: Record<
    "free" | "starter" | "pro",
    {
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
  > = {
    free: {
      maxWorkspaces: 1,
      maxDocuments: 10,
      maxDocumentSizeBytes: 1024 * 1024,
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
      maxDocumentSizeBytes: 10 * 1024 * 1024,
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
      maxDocumentSizeBytes: 100 * 1024 * 1024,
      maxAgents: 50,
      maxDailyRequests: 10000,
      maxUsers: 5,
      // maxManagers: undefined (unlimited)
      maxAgentKeys: 250,
      maxChannels: 50,
      maxMcpServers: 50,
    },
  };
  return limits[plan];
}
