import type { FC } from "react";
import { useState } from "react";

import type { UsageStats as UsageStatsType, Currency } from "../utils/api";
import { getTokenUsageColor, getCostColor } from "../utils/colorUtils";
import { formatCurrency } from "../utils/currency";

interface UsageStatsProps {
  stats: UsageStatsType;
  title?: string;
}

const formatNumber = (value: number): string => {
  return new Intl.NumberFormat("en-US").format(value);
};

export const UsageStats: FC<UsageStatsProps> = ({
  stats,
  title = "Usage Statistics",
}) => {
  const currency: Currency = "usd";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-neutral-900">
      <h3 className="mb-4 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">{title}</h3>
      <p className="mb-8 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
        Input tokens are the text you send to the AI. Output tokens are the text the AI generates. Total tokens is the sum of both. Total Cost includes all costs: token costs (from model usage), tool costs (from external tools like web search), reranking costs (from knowledge base document reranking), and eval costs (from evaluation judge calls). Reranking Cost and Eval Cost are shown separately when present. Conversation count shows the number of unique conversations. Messages in are user messages, messages out are assistant responses. Tool usage shows calls to external tools like web search and URL fetching. BYOK (Bring Your Own Key) shows usage with your own API keys, while Platform shows usage with platform-provided keys.
      </p>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Conversation and Messages Group - Success (Green) */}
        <div className="rounded-xl border border-success-200 bg-success-100 p-5 dark:border-success-700 dark:bg-success-900">
          <div className="mb-2 text-sm font-semibold text-success-700 dark:text-success-300">Conversations</div>
          <div className="text-3xl font-bold text-success-900 dark:text-success-50">{formatNumber(stats.conversationCount)}</div>
        </div>
        <div className="rounded-xl border border-success-200 bg-success-100 p-5 dark:border-success-700 dark:bg-success-900">
          <div className="mb-2 text-sm font-semibold text-success-700 dark:text-success-300">Messages In</div>
          <div className="text-3xl font-bold text-success-900 dark:text-success-50">{formatNumber(stats.messagesIn)}</div>
        </div>
        <div className="rounded-xl border border-success-200 bg-success-100 p-5 dark:border-success-700 dark:bg-success-900">
          <div className="mb-2 text-sm font-semibold text-success-700 dark:text-success-300">Messages Out</div>
          <div className="text-3xl font-bold text-success-900 dark:text-success-50">{formatNumber(stats.messagesOut)}</div>
        </div>
        <div className="rounded-xl border border-success-200 bg-success-100 p-5 dark:border-success-700 dark:bg-success-900">
          <div className="mb-2 text-sm font-semibold text-success-700 dark:text-success-300">Total Messages</div>
          <div className="text-3xl font-bold text-success-900 dark:text-success-50">{formatNumber(stats.totalMessages)}</div>
        </div>
        {/* Tokens Group - Primary (Teal) */}
        <div className="rounded-xl border border-primary-200 bg-primary-100 p-5 dark:border-primary-700 dark:bg-primary-900">
          <div className="mb-2 text-sm font-semibold text-primary-700 dark:text-primary-300">Input Tokens</div>
          <div className="text-3xl font-bold text-primary-900 dark:text-primary-50">{formatNumber(stats.inputTokens)}</div>
        </div>
        <div className="rounded-xl border border-primary-200 bg-primary-100 p-5 dark:border-primary-700 dark:bg-primary-900">
          <div className="mb-2 text-sm font-semibold text-primary-700 dark:text-primary-300">Output Tokens</div>
          <div className="text-3xl font-bold text-primary-900 dark:text-primary-50">{formatNumber(stats.outputTokens)}</div>
        </div>
        <div className="rounded-xl border border-primary-200 bg-primary-100 p-5 dark:border-primary-700 dark:bg-primary-900">
          <div className="mb-2 text-sm font-semibold text-primary-700 dark:text-primary-300">Total Tokens</div>
          <div className="text-3xl font-bold text-primary-900 dark:text-primary-50">{formatNumber(stats.totalTokens)}</div>
        </div>
        {/* Costs Group - Accent (Purple) */}
        {(stats.rerankingCostUsd !== undefined && stats.rerankingCostUsd > 0) && (
          <div className="rounded-xl border border-accent-200 bg-accent-100 p-5 dark:border-accent-700 dark:bg-accent-900">
            <div className="mb-2 text-sm font-semibold text-accent-700 dark:text-accent-300">Reranking Cost</div>
            <div className="text-3xl font-bold text-accent-900 dark:text-accent-50">{formatCurrency(stats.rerankingCostUsd, currency, 10)}</div>
          </div>
        )}
        {(stats.evalCostUsd !== undefined && stats.evalCostUsd > 0) && (
          <div className="rounded-xl border border-accent-200 bg-accent-100 p-5 dark:border-accent-700 dark:bg-accent-900">
            <div className="mb-2 text-sm font-semibold text-accent-700 dark:text-accent-300">Eval Cost</div>
            <div className="text-3xl font-bold text-accent-900 dark:text-accent-50">{formatCurrency(stats.evalCostUsd, currency, 10)}</div>
          </div>
        )}
        <div className="rounded-xl border border-accent-200 bg-accent-100 p-5 dark:border-accent-700 dark:bg-accent-900">
          <div className="mb-2 text-sm font-semibold text-accent-700 dark:text-accent-300">Total Cost</div>
          <div className="text-3xl font-bold text-accent-900 dark:text-accent-50">{formatCurrency(stats.cost, currency, 10)}</div>
        </div>
      </div>

      {stats.byModel.length > 0 && (
        <div className="mb-8">
          <h4 className="mb-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">By Model</h4>
          <div className="space-y-3">
            {stats.byModel.map((model: { model: string; totalTokens: number; cost: number }) => (
              <div
                key={model.model}
                className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors duration-200 hover:border-primary-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-neutral-900 dark:text-neutral-50">{model.model}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-lg border px-2 py-1 text-xs font-semibold ${getTokenUsageColor(
                        model.totalTokens
                      )}`}
                    >
                      {formatNumber(model.totalTokens)} tokens
                    </span>
                    <span
                      className={`rounded-lg border px-2 py-1 text-xs font-semibold ${getCostColor(
                        model.cost
                      )}`}
                    >
                      {formatCurrency(model.cost, currency, 10)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.byProvider.length > 0 && (
        <div className="mb-8">
          <h4 className="mb-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">By Provider</h4>
          <div className="space-y-3">
            {stats.byProvider.map((provider: { provider: string; totalTokens: number; cost: number }) => (
              <div
                key={provider.provider}
                className="rounded-xl border border-neutral-200 bg-white p-4 transition-colors duration-200 hover:border-primary-300 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-neutral-900 dark:text-neutral-50">{provider.provider}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-lg border px-2 py-1 text-xs font-semibold ${getTokenUsageColor(
                        provider.totalTokens
                      )}`}
                    >
                      {formatNumber(provider.totalTokens)} tokens
                    </span>
                    <span
                      className={`rounded-lg border px-2 py-1 text-xs font-semibold ${getCostColor(
                        provider.cost
                      )}`}
                    >
                      {formatCurrency(provider.cost, currency, 10)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.toolExpenses && stats.toolExpenses.length > 0 && (
        <div className="mb-8">
          <h4 className="mb-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">Tool Usage</h4>
          <ToolUsageSection toolExpenses={stats.toolExpenses} currency={currency} />
        </div>
      )}

      <div>
        <h4 className="mb-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">By Key Type</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="mb-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300">BYOK</div>
            <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              {formatCurrency(stats.byByok.byok.cost, currency, 10)}
            </div>
            <div className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">
              {formatNumber(stats.byByok.byok.totalTokens)} tokens
            </div>
          </div>
          <div className="bg-gradient-primary/10 rounded-xl border border-primary-300 p-5 dark:border-primary-700 dark:bg-primary-950/50">
            <div className="mb-2 text-sm font-semibold text-primary-700 dark:text-primary-300">Platform</div>
            <div className="text-2xl font-bold text-primary-900 dark:text-primary-100">
              {formatCurrency(stats.byByok.platform.cost, currency, 10)}
            </div>
            <div className="mt-1 text-xs text-primary-700 dark:text-primary-300">
              {formatNumber(stats.byByok.platform.totalTokens)} tokens
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ToolUsageSectionProps {
  toolExpenses: Array<{
    toolCall: string;
    supplier: string;
    cost: number;
    callCount: number;
  }>;
  currency: Currency;
}

const ToolUsageSection: FC<ToolUsageSectionProps> = ({ toolExpenses, currency }) => {
  // Group tools by supplier
  const toolsBySupplier = new Map<string, typeof toolExpenses>();
  
  for (const tool of toolExpenses) {
    if (!toolsBySupplier.has(tool.supplier)) {
      toolsBySupplier.set(tool.supplier, []);
    }
    toolsBySupplier.get(tool.supplier)!.push(tool);
  }

  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());

  const toggleSupplier = (supplier: string) => {
    const newExpanded = new Set(expandedSuppliers);
    if (newExpanded.has(supplier)) {
      newExpanded.delete(supplier);
    } else {
      newExpanded.add(supplier);
    }
    setExpandedSuppliers(newExpanded);
  };

  return (
    <div className="space-y-3">
      {Array.from(toolsBySupplier.entries()).map(([supplier, tools]) => {
        const totalCost = tools.reduce((sum, t) => sum + t.cost, 0);
        const totalCalls = tools.reduce((sum, t) => sum + t.callCount, 0);
        const isExpanded = expandedSuppliers.has(supplier);

        return (
          <div
            key={supplier}
            className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
          >
            <button
              onClick={() => toggleSupplier(supplier)}
              className="w-full p-4 text-left transition-colors duration-200 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-neutral-900 dark:text-neutral-50">
                    {supplier.charAt(0).toUpperCase() + supplier.slice(1)}
                  </span>
                  <span className="text-sm text-neutral-600 dark:text-neutral-400">
                    ({tools.length} {tools.length === 1 ? "tool" : "tools"})
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                      {formatNumber(totalCalls)} {totalCalls === 1 ? "call" : "calls"}
                    </div>
                    <div className={`text-sm font-semibold ${getCostColor(totalCost)}`}>
                      {formatCurrency(totalCost, currency, 10)}
                    </div>
                  </div>
                  <svg
                    className={`size-5 text-neutral-500 transition-transform duration-200 ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </div>
            </button>
            {isExpanded && (
              <div className="border-t border-neutral-200 p-4 dark:border-neutral-700">
                <div className="space-y-2">
                  {tools.map((tool) => (
                    <div
                      key={`${tool.toolCall}-${tool.supplier}`}
                      className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800"
                    >
                      <span className="font-medium text-neutral-900 dark:text-neutral-50">
                        {tool.toolCall}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-xs font-semibold text-neutral-700 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300">
                          {formatNumber(tool.callCount)} {tool.callCount === 1 ? "call" : "calls"}
                        </span>
                        <span
                          className={`rounded-lg border px-2 py-1 text-xs font-semibold ${getCostColor(
                            tool.cost
                          )}`}
                        >
                          {formatCurrency(tool.cost, currency, 10)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

