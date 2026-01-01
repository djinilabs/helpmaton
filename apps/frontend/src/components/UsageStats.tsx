import type { FC } from "react";

import type { UsageStats as UsageStatsType } from "../utils/api";
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
  const currency = "usd";
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-neutral-900">
      <h3 className="mb-4 text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50">{title}</h3>
      <p className="mb-8 text-base leading-relaxed text-neutral-600 dark:text-neutral-300">
        Input tokens are the text you send to the AI. Output tokens are the text the AI generates. Total tokens is the sum of both. Cost is calculated based on the model used and token counts. BYOK (Bring Your Own Key) shows usage with your own API keys, while Platform shows usage with platform-provided keys.
      </p>

      <div className="mb-8 grid grid-cols-2 gap-4">
        <div className={`rounded-xl border p-5 ${getTokenUsageColor(stats.inputTokens).split(' ').filter(c => c.startsWith('bg-') || c.startsWith('dark:bg-') || c.startsWith('border-') || c.startsWith('dark:border-')).join(' ')}`}>
          <div className="mb-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300">Input Tokens</div>
          <div className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">{formatNumber(stats.inputTokens)}</div>
        </div>
        <div className={`rounded-xl border p-5 ${getTokenUsageColor(stats.outputTokens).split(' ').filter(c => c.startsWith('bg-') || c.startsWith('dark:bg-') || c.startsWith('border-') || c.startsWith('dark:border-')).join(' ')}`}>
          <div className="mb-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300">Output Tokens</div>
          <div className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">{formatNumber(stats.outputTokens)}</div>
        </div>
        <div className={`rounded-xl border p-5 ${getTokenUsageColor(stats.totalTokens).split(' ').filter(c => c.startsWith('bg-') || c.startsWith('dark:bg-') || c.startsWith('border-') || c.startsWith('dark:border-')).join(' ')}`}>
          <div className="mb-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300">Total Tokens</div>
          <div className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">{formatNumber(stats.totalTokens)}</div>
        </div>
        <div className={`rounded-xl border p-5 ${getCostColor(stats.cost).split(' ').filter(c => c.startsWith('bg-') || c.startsWith('dark:bg-') || c.startsWith('border-') || c.startsWith('dark:border-')).join(' ')}`}>
          <div className="mb-2 text-sm font-semibold text-neutral-600 dark:text-neutral-300">Total Cost</div>
          <div className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">{formatCurrency(stats.cost, currency, 10)}</div>
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

