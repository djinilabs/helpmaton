import type { FC } from "react";

import { useSubscriptionCheckout } from "../hooks/useSubscription";

interface PlanComparisonProps {
  currentPlan: "free" | "starter" | "pro";
  onUpgrade?: (plan: "starter" | "pro") => void;
  onDowngrade?: () => void;
}

export const PlanComparison: FC<PlanComparisonProps> = ({
  currentPlan,
  onUpgrade,
  onDowngrade,
}) => {
  const checkoutMutation = useSubscriptionCheckout();

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
      price: "€0",
      period: "forever",
      limits: freeLimits,
      features: [
        `${freeLimits?.maxWorkspaces || 1} workspace`,
        `${freeLimits?.maxDocuments || 10} documents`,
        `${freeLimits?.maxAgents || 1} agent`,
        `${(freeLimits?.maxDocumentSizeBytes || 0) / (1024 * 1024)} MB storage`,
      ],
    },
    {
      name: "Starter",
      plan: "starter" as const,
      price: "€29",
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
      ],
    },
    {
      name: "Pro",
      plan: "pro" as const,
      price: "€99",
      period: "per month",
      limits: proLimits,
      features: [
        `${proLimits?.maxWorkspaces || 5} workspaces`,
        `${proLimits?.maxDocuments || 1000} documents`,
        `${proLimits?.maxAgents || 50} agents`,
        `${(proLimits?.maxDocumentSizeBytes || 0) / (1024 * 1024)} MB storage`,
        `${proLimits?.maxDailyRequests || 0} requests/day`,
        "Unlimited managers",
      ],
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
            className={`border rounded-2xl p-6 ${
              isCurrent
                ? "border-primary-500 bg-primary-50"
                : "border-neutral-200 bg-white"
            }`}
          >
            <div className="mb-4">
              <h3 className="text-2xl font-bold text-neutral-900 mb-2">
                {plan.name}
              </h3>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-neutral-900">
                  {plan.price}
                </span>
                <span className="text-neutral-600">{plan.period}</span>
              </div>
              {isCurrent && (
                <span className="inline-block mt-2 px-3 py-1 bg-primary-500 text-white text-sm font-semibold rounded-full">
                  Current Plan
                </span>
              )}
            </div>

            <ul className="space-y-2 mb-6">
              {plan.features.map((feature, index) => (
                <li key={index} className="flex items-start gap-2">
                  <svg
                    className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0"
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
                  <span className="text-neutral-700">{feature}</span>
                </li>
              ))}
            </ul>

            {canUpgrade && (
              <button
                onClick={() => handleUpgrade(plan.plan)}
                disabled={checkoutMutation.isPending}
                className="w-full bg-gradient-primary text-white font-semibold py-3 px-6 rounded-xl hover:shadow-colored transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {checkoutMutation.isPending ? "Loading..." : "Upgrade"}
              </button>
            )}

            {canDowngrade && onDowngrade && (
              <button
                onClick={onDowngrade}
                className="w-full border border-neutral-300 text-neutral-700 font-semibold py-3 px-6 rounded-xl hover:bg-neutral-50 transition-all duration-200"
              >
                Downgrade
              </button>
            )}

            {isCurrent && !canUpgrade && !canDowngrade && (
              <div className="text-center text-neutral-600 font-medium py-3">
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
    }
  > = {
    free: {
      maxWorkspaces: 1,
      maxDocuments: 10,
      maxDocumentSizeBytes: 1024 * 1024,
      maxAgents: 1,
      maxDailyRequests: 50,
    },
    starter: {
      maxWorkspaces: 1,
      maxDocuments: 100,
      maxDocumentSizeBytes: 10 * 1024 * 1024,
      maxAgents: 5,
      maxDailyRequests: 2500,
    },
    pro: {
      maxWorkspaces: 5,
      maxDocuments: 1000,
      maxDocumentSizeBytes: 100 * 1024 * 1024,
      maxAgents: 50,
      maxDailyRequests: 25000,
    },
  };
  return limits[plan];
}
