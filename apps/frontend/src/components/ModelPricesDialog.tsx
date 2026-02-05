import {
  ChevronDownIcon,
  ChevronUpIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, useEffect, useMemo, useCallback } from "react";
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

import { ScrollContainer } from "./ScrollContainer";
import { VirtualTable } from "./VirtualTable";

type SortColumn =
  | "model"
  | "input"
  | "output"
  | "cachedInput"
  | "request"
  | "capabilities";

const PRICE_SORT_AFTER = Number.MAX_VALUE;

function getPriceSortValue(
  pricing: ModelPricing,
  field: "input" | "output" | "cachedInput" | "request"
): number {
  const value = pricing.tiers?.[0]?.[field] ?? pricing[field];
  return value !== undefined && value !== null ? value : PRICE_SORT_AFTER;
}

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

type ModelRow = { modelName: string; pricing: ModelPricing };

export const ModelPricesDialog: FC<ModelPricesDialogProps> = ({
  isOpen,
  onClose,
  capabilityFilter,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortColumn, setSortColumn] = useState<SortColumn>("model");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

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

    return [...models].sort(([a], [b]) => a.localeCompare(b));
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

  const sortedModels = useMemo(() => {
    const list = [...filteredModels];
    const mult = sortDirection === "asc" ? 1 : -1;

    list.sort(([nameA, pricingA], [nameB, pricingB]) => {
      let cmp: number;

      switch (sortColumn) {
        case "model":
          cmp = nameA.localeCompare(nameB);
          break;
        case "input":
          cmp = getPriceSortValue(pricingA, "input") - getPriceSortValue(pricingB, "input");
          break;
        case "output":
          cmp = getPriceSortValue(pricingA, "output") - getPriceSortValue(pricingB, "output");
          break;
        case "cachedInput":
          cmp =
            getPriceSortValue(pricingA, "cachedInput") -
            getPriceSortValue(pricingB, "cachedInput");
          break;
        case "request":
          cmp = getPriceSortValue(pricingA, "request") - getPriceSortValue(pricingB, "request");
          break;
        case "capabilities": {
          const labelsA =
            getCapabilityLabels(modelsData?.openrouter?.capabilities?.[nameA]).join(", ") || "N/A";
          const labelsB =
            getCapabilityLabels(modelsData?.openrouter?.capabilities?.[nameB]).join(", ") || "N/A";
          cmp = labelsA.localeCompare(labelsB);
          break;
        }
        default:
          cmp = 0;
      }

      // Tie-breaker: same value → sort by model name for stable, deterministic order
      if (cmp !== 0) return mult * cmp;
      return nameA.localeCompare(nameB);
    });

    return list;
  }, [filteredModels, sortColumn, sortDirection, modelsData]);

  const handleSort = useCallback((column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }, [sortColumn]);

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

            <ScrollContainer
              ref={scrollRef}
              className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700"
              maxHeight="min(60vh, 480px)"
            >
              <VirtualTable<ModelRow>
                scrollRef={scrollRef}
                rows={sortedModels.map(([modelName, pricing]) => ({
                  modelName,
                  pricing,
                }))}
                rowHeight={52}
                getItemKey={(_, row) => row.modelName}
                columns={[
                  {
                    key: "model",
                    header: (
                      <button
                        type="button"
                        onClick={() => handleSort("model")}
                        className="inline-flex w-full items-center gap-1 text-left text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 dark:text-neutral-50 dark:hover:bg-neutral-800"
                      >
                        Model
                        {sortColumn === "model" &&
                          (sortDirection === "asc" ? (
                            <ChevronUpIcon className="size-4" aria-hidden />
                          ) : (
                            <ChevronDownIcon className="size-4" aria-hidden />
                          ))}
                      </button>
                    ),
                    render: (row) => (
                      <code className="break-words rounded border border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-xs font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                        {row.modelName}
                      </code>
                    ),
                    width: "minmax(160px, 2fr)",
                  },
                  {
                    key: "input",
                    header: (
                      <button
                        type="button"
                        onClick={() => handleSort("input")}
                        className="inline-flex w-full items-center gap-1 text-left text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 dark:text-neutral-50 dark:hover:bg-neutral-800"
                      >
                        Input (per 1M tokens)
                        {sortColumn === "input" &&
                          (sortDirection === "asc" ? (
                            <ChevronUpIcon className="size-4" aria-hidden />
                          ) : (
                            <ChevronDownIcon className="size-4" aria-hidden />
                          ))}
                      </button>
                    ),
                    render: (row) => {
                      const hasTiers =
                        row.pricing.tiers && row.pricing.tiers.length > 0;
                      return (
                        <span className="text-sm text-neutral-700 dark:text-neutral-300">
                          {hasTiers
                            ? formatTieredPrice(row.pricing)
                            : formatPrice(row.pricing.input)}
                        </span>
                      );
                    },
                    width: "minmax(100px, 1fr)",
                  },
                  {
                    key: "output",
                    header: (
                      <button
                        type="button"
                        onClick={() => handleSort("output")}
                        className="inline-flex w-full items-center gap-1 text-left text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 dark:text-neutral-50 dark:hover:bg-neutral-800"
                      >
                        Output (per 1M tokens)
                        {sortColumn === "output" &&
                          (sortDirection === "asc" ? (
                            <ChevronUpIcon className="size-4" aria-hidden />
                          ) : (
                            <ChevronDownIcon className="size-4" aria-hidden />
                          ))}
                      </button>
                    ),
                    render: (row) => {
                      const hasTiers =
                        row.pricing.tiers && row.pricing.tiers.length > 0;
                      return (
                        <span className="text-sm text-neutral-700 dark:text-neutral-300">
                          {hasTiers
                            ? formatTieredPrice(row.pricing)
                            : formatPrice(row.pricing.output)}
                        </span>
                      );
                    },
                    width: "minmax(100px, 1fr)",
                  },
                  {
                    key: "cachedInput",
                    header: (
                      <button
                        type="button"
                        onClick={() => handleSort("cachedInput")}
                        className="inline-flex w-full items-center gap-1 text-left text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 dark:text-neutral-50 dark:hover:bg-neutral-800"
                      >
                        Cached Input (per 1M tokens)
                        {sortColumn === "cachedInput" &&
                          (sortDirection === "asc" ? (
                            <ChevronUpIcon className="size-4" aria-hidden />
                          ) : (
                            <ChevronDownIcon className="size-4" aria-hidden />
                          ))}
                      </button>
                    ),
                    render: (row) => {
                      const hasTiers =
                        row.pricing.tiers && row.pricing.tiers.length > 0;
                      return (
                        <span className="text-sm text-neutral-700 dark:text-neutral-300">
                          {hasTiers
                            ? formatTieredPrice(row.pricing)
                            : formatPrice(row.pricing.cachedInput)}
                        </span>
                      );
                    },
                    width: "minmax(100px, 1fr)",
                  },
                  {
                    key: "request",
                    header: (
                      <button
                        type="button"
                        onClick={() => handleSort("request")}
                        className="inline-flex w-full items-center gap-1 text-left text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 dark:text-neutral-50 dark:hover:bg-neutral-800"
                      >
                        Request (per request)
                        {sortColumn === "request" &&
                          (sortDirection === "asc" ? (
                            <ChevronUpIcon className="size-4" aria-hidden />
                          ) : (
                            <ChevronDownIcon className="size-4" aria-hidden />
                          ))}
                      </button>
                    ),
                    render: (row) => {
                      const hasTiers =
                        row.pricing.tiers && row.pricing.tiers.length > 0;
                      const requestPrice = hasTiers
                        ? row.pricing.tiers?.[0]?.request !== undefined
                          ? formatPrice(row.pricing.tiers[0].request)
                          : "N/A"
                        : formatPrice(row.pricing.request);
                      return (
                        <span className="text-sm text-neutral-700 dark:text-neutral-300">
                          {requestPrice}
                        </span>
                      );
                    },
                    width: "minmax(90px, 1fr)",
                  },
                  {
                    key: "capabilities",
                    header: (
                      <button
                        type="button"
                        onClick={() => handleSort("capabilities")}
                        className="inline-flex w-full items-center gap-1 text-left text-sm font-semibold text-neutral-900 transition-colors hover:bg-neutral-100 dark:text-neutral-50 dark:hover:bg-neutral-800"
                      >
                        Capabilities
                        {sortColumn === "capabilities" &&
                          (sortDirection === "asc" ? (
                            <ChevronUpIcon className="size-4" aria-hidden />
                          ) : (
                            <ChevronDownIcon className="size-4" aria-hidden />
                          ))}
                      </button>
                    ),
                    render: (row) => {
                      const capabilityLabels = getCapabilityLabels(
                        modelsData?.openrouter?.capabilities?.[row.modelName]
                      );
                      return (
                        <span className="text-xs text-neutral-700 dark:text-neutral-300">
                          {capabilityLabels.length > 0
                            ? capabilityLabels.join(", ")
                            : "N/A"}
                        </span>
                      );
                    },
                    width: "minmax(140px, 2fr)",
                  },
                ]}
                empty={
                  <div className="px-4 py-8 text-center text-sm text-neutral-600 dark:text-neutral-300">
                    No models found
                  </div>
                }
              />
            </ScrollContainer>

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

