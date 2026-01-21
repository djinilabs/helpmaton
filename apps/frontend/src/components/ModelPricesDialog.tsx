import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import {
  getAvailableModels,
  getModelPricing,
  type ModelCapabilities,
  type ModelPricing,
} from "../utils/api";
import { getCapabilityLabels } from "../utils/modelConfig";

interface ModelPricesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  capabilityFilter?: keyof ModelCapabilities;
}

// Apply 5.5% markup to OpenRouter prices (same as backend calculation)
const applyMarkup = (price: number): number => {
  return price * 1.055;
};

const formatPrice = (price: number | undefined): string => {
  if (price === undefined || price === null) {
    return "N/A";
  }
  // Price is in USD per 1M tokens (raw OpenRouter price)
  // Apply 5.5% markup to show the actual cost to users
  const priceWithMarkup = applyMarkup(price);
  // Round up to 10th decimal position using Math.ceil
  const multiplier = Math.pow(10, 10);
  const roundedPrice = Math.ceil(priceWithMarkup * multiplier) / multiplier;
  // Format to 10 decimals and remove trailing zeros
  return `$${roundedPrice.toFixed(10).replace(/\.?0+$/, "")}`;
};

const formatTieredPrice = (pricing: ModelPricing): string => {
  if (pricing.tiers && pricing.tiers.length > 0) {
    const firstTier = pricing.tiers[0];
    if (firstTier.input !== undefined) {
      // Apply markup to tiered pricing as well
      const priceWithMarkup = applyMarkup(firstTier.input);
      // Round up to 10th decimal position using Math.ceil
      const multiplier = Math.pow(10, 10);
      const roundedPrice = Math.ceil(priceWithMarkup * multiplier) / multiplier;
      // Format to 10 decimals and remove trailing zeros
      return `$${roundedPrice.toFixed(10).replace(/\.?0+$/, "")} (tiered)`;
    }
  }
  return "N/A";
};

export const ModelPricesDialog: FC<ModelPricesDialogProps> = ({
  isOpen,
  onClose,
  capabilityFilter,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: modelsData } = useQuery({
    queryKey: ["availableModels"],
    queryFn: getAvailableModels,
    enabled: isOpen,
  });

  const { data: pricingData, isLoading, error } = useQuery({
    queryKey: ["modelPricing"],
    queryFn: getModelPricing,
    enabled: isOpen,
  });

  const { registerDialog, unregisterDialog } = useDialogTracking();
  useEscapeKey(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const capabilityScopedModels = useMemo(() => {
    if (!pricingData?.openrouter) {
      return [];
    }

    const capabilities = modelsData?.openrouter?.capabilities;
    let models = Object.entries(pricingData.openrouter);
    if (capabilityFilter) {
      models = models.filter(
        ([modelName]) => capabilities?.[modelName]?.[capabilityFilter] === true
      );
    }

    return models.sort(([a], [b]) => a.localeCompare(b));
  }, [pricingData, modelsData, capabilityFilter]);

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) {
      return capabilityScopedModels;
    }

    const query = searchQuery.toLowerCase();
    return capabilityScopedModels.filter(([modelName]) =>
      modelName.toLowerCase().includes(query)
    );
  }, [capabilityScopedModels, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-4xl font-black text-neutral-900 dark:text-neutral-50">
            OpenRouter Model Prices
          </h2>
          <button
            onClick={onClose}
            className="rounded-xl border border-neutral-300 bg-white px-6 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            Close
          </button>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          />
        </div>

        {isLoading && (
          <div className="py-8 text-center">
            <div className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
              Loading pricing...
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">
              Error loading pricing
            </p>
            <p className="mt-1 text-xs text-red-700 dark:text-red-300">
              {error instanceof Error ? error.message : "Unknown error"}
            </p>
          </div>
        )}

        {!isLoading && !error && pricingData && (
          <>
            <div className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
              Showing {filteredModels.length} of{" "}
              {capabilityScopedModels.length} models
              {searchQuery && ` matching "${searchQuery}"`}
              {capabilityFilter && ` filtered by ${capabilityFilter}`}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-neutral-300 dark:border-neutral-700">
                    <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      Model
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      Input (per 1M tokens)
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      Output (per 1M tokens)
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      Cached Input (per 1M tokens)
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      Request (per request)
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      Capabilities
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredModels.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-sm text-neutral-600 dark:text-neutral-300"
                      >
                        No models found
                      </td>
                    </tr>
                  ) : (
                    filteredModels.map(([modelName, pricing]) => {
                      const capabilityLabels = getCapabilityLabels(
                        modelsData?.openrouter?.capabilities?.[modelName]
                      );
                      const hasTiers = pricing.tiers && pricing.tiers.length > 0;
                      const inputPrice = hasTiers
                        ? formatTieredPrice(pricing)
                        : formatPrice(pricing.input);
                      const outputPrice = hasTiers
                        ? formatTieredPrice(pricing)
                        : formatPrice(pricing.output);
                      const cachedInputPrice = hasTiers
                        ? formatTieredPrice(pricing)
                        : formatPrice(pricing.cachedInput);
                      // Request price is per-request (not per token), so handle it separately
                      // For tiered pricing, check if first tier has request price
                      const requestPrice = hasTiers
                        ? pricing.tiers?.[0]?.request !== undefined
                          ? formatPrice(pricing.tiers[0].request)
                          : "N/A"
                        : formatPrice(pricing.request);

                      return (
                        <tr
                          key={modelName}
                          className="border-b border-neutral-200 dark:border-neutral-700"
                        >
                          <td className="px-4 py-3">
                            <code className="rounded border border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-xs font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                              {modelName}
                            </code>
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300">
                            {inputPrice}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300">
                            {outputPrice}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300">
                            {cachedInputPrice}
                          </td>
                          <td className="px-4 py-3 text-sm text-neutral-700 dark:text-neutral-300">
                            {requestPrice}
                          </td>
                          <td className="px-4 py-3 text-xs text-neutral-700 dark:text-neutral-300">
                            {capabilityLabels.length > 0
                              ? capabilityLabels.join(", ")
                              : "N/A"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-800 dark:text-blue-200">
                <InformationCircleIcon className="size-4" />
                Pricing Information
              </p>
              <p className="text-xs text-blue-900 dark:text-blue-100">
                All prices are in USD. Token prices are per 1 million tokens, while
                request prices are per request. Tiered pricing models show the first
                tier price. Prices include a 5.5% markup for OpenRouter credit
                purchase fees. Cached input tokens are typically charged at a lower
                rate than regular input tokens.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

