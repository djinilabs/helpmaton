import type { FC } from "react";

import type { UsageStats as UsageStatsType } from "../utils/api";
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
    <div className="bg-white rounded-2xl shadow-medium p-8 border border-neutral-200 dark:bg-neutral-900 dark:border-neutral-700">
      <h3 className="text-2xl font-bold text-neutral-900 mb-4 tracking-tight dark:text-neutral-50">{title}</h3>
      <p className="text-base text-neutral-600 mb-8 leading-relaxed dark:text-neutral-400">
        Input tokens are the text you send to the AI. Output tokens are the text the AI generates. Total tokens is the sum of both. Cost is calculated based on the model used and token counts. BYOK (Bring Your Own Key) shows usage with your own API keys, while Platform shows usage with platform-provided keys.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="border border-neutral-200 rounded-xl p-5 bg-neutral-50/50 dark:border-neutral-700 dark:bg-neutral-800/50">
          <div className="text-sm font-semibold text-neutral-600 mb-2 dark:text-neutral-400">Input Tokens</div>
          <div className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">{formatNumber(stats.inputTokens)}</div>
        </div>
        <div className="border border-neutral-200 rounded-xl p-5 bg-neutral-50/50 dark:border-neutral-700 dark:bg-neutral-800/50">
          <div className="text-sm font-semibold text-neutral-600 mb-2 dark:text-neutral-400">Output Tokens</div>
          <div className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">{formatNumber(stats.outputTokens)}</div>
        </div>
        <div className="border border-neutral-200 rounded-xl p-5 bg-neutral-50/50 dark:border-neutral-700 dark:bg-neutral-800/50">
          <div className="text-sm font-semibold text-neutral-600 mb-2 dark:text-neutral-400">Total Tokens</div>
          <div className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">{formatNumber(stats.totalTokens)}</div>
        </div>
        <div className="border border-primary-300 rounded-xl p-5 bg-gradient-primary/10 dark:border-primary-700 dark:bg-primary-950/50">
          <div className="text-sm font-semibold text-primary-700 mb-2 dark:text-primary-300">Total Cost</div>
          <div className="text-3xl font-bold text-primary-900 dark:text-primary-100">{formatCurrency(stats.cost, currency, 4)}</div>
        </div>
      </div>

      {stats.byModel.length > 0 && (
        <div className="mb-8">
          <h4 className="text-xl font-bold text-neutral-900 mb-4 dark:text-neutral-50">By Model</h4>
          <div className="space-y-3">
            {stats.byModel.map((model: { model: string; totalTokens: number; cost: number }) => (
              <div
                key={model.model}
                className="border border-neutral-200 rounded-xl p-4 bg-white hover:border-primary-300 transition-colors duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500"
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-neutral-900 dark:text-neutral-50">{model.model}</span>
                  <div className="text-right">
                    <div className="text-sm text-neutral-600 dark:text-neutral-400">
                      {formatNumber(model.totalTokens)} tokens
                    </div>
                    <div className="font-bold text-neutral-900 dark:text-neutral-50">
                      {formatCurrency(model.cost, currency, 4)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.byProvider.length > 0 && (
        <div className="mb-8">
          <h4 className="text-xl font-bold text-neutral-900 mb-4 dark:text-neutral-50">By Provider</h4>
          <div className="space-y-3">
            {stats.byProvider.map((provider: { provider: string; totalTokens: number; cost: number }) => (
              <div
                key={provider.provider}
                className="border border-neutral-200 rounded-xl p-4 bg-white hover:border-primary-300 transition-colors duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500"
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-neutral-900 dark:text-neutral-50">{provider.provider}</span>
                  <div className="text-right">
                    <div className="text-sm text-neutral-600 dark:text-neutral-400">
                      {formatNumber(provider.totalTokens)} tokens
                    </div>
                    <div className="font-bold text-neutral-900 dark:text-neutral-50">
                      {formatCurrency(provider.cost, currency, 4)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="text-xl font-bold text-neutral-900 mb-4 dark:text-neutral-50">By Key Type</h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="border border-neutral-200 rounded-xl p-5 bg-white dark:border-neutral-700 dark:bg-neutral-900">
            <div className="text-sm font-semibold text-neutral-600 mb-2 dark:text-neutral-400">BYOK</div>
            <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              {formatCurrency(stats.byByok.byok.cost, currency, 4)}
            </div>
            <div className="text-xs text-neutral-600 mt-1 dark:text-neutral-400">
              {formatNumber(stats.byByok.byok.totalTokens)} tokens
            </div>
          </div>
          <div className="border border-primary-300 rounded-xl p-5 bg-gradient-primary/10 dark:border-primary-700 dark:bg-primary-950/50">
            <div className="text-sm font-semibold text-primary-700 mb-2 dark:text-primary-300">Platform</div>
            <div className="text-2xl font-bold text-primary-900 dark:text-primary-100">
              {formatCurrency(stats.byByok.platform.cost, currency, 4)}
            </div>
            <div className="text-xs text-primary-700 mt-1 dark:text-primary-300">
              {formatNumber(stats.byByok.platform.totalTokens)} tokens
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

