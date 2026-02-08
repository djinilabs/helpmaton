import { useState, useEffect, useRef, type FC } from "react";

import { useAgentMemory } from "../hooks/useAgentMemory";
import { useToast } from "../hooks/useToast";
import {
  getAgentMemoryRecord,
  type AgentMemoryResult,
  type TemporalGrain,
} from "../utils/api";
import { trackEvent } from "../utils/tracking";

import { ScrollContainer } from "./ScrollContainer";
import { Slider } from "./Slider";
import { VirtualList } from "./VirtualList";

interface AgentMemoryRecordsProps {
  workspaceId: string;
  agentId: string;
}

export const AgentMemoryRecords: FC<AgentMemoryRecordsProps> = ({
  workspaceId,
  agentId,
}) => {
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const previewLength = 120;
  const [grain, setGrain] = useState<TemporalGrain>("working");
  const [queryText, setQueryText] = useState("");
  const [minimumDaysAgo, setMinimumDaysAgo] = useState(0);
  const [maximumDaysAgo, setMaximumDaysAgo] = useState(365);
  const [maxResults, setMaxResults] = useState(50);
  const [expandedRecordIds, setExpandedRecordIds] = useState<
    Record<string, boolean>
  >({});
  const [fullContentById, setFullContentById] = useState<
    Record<string, string>
  >({});
  const [loadingRecordIds, setLoadingRecordIds] = useState<
    Record<string, boolean>
  >({});
  const [recordErrors, setRecordErrors] = useState<Record<string, string>>({});

  const { data, isLoading, error, refetch, isRefetching } = useAgentMemory(
    workspaceId,
    agentId,
    {
      grain,
      queryText: queryText.trim().length > 0 ? queryText.trim() : undefined,
      minimumDaysAgo,
      maximumDaysAgo,
      maxResults,
      previewLength,
    }
  );

  const hasTrackedMemory = useRef(false);
  const lastTrackedKey = useRef<string>("");

  // Track memory viewing - only once per data load
  useEffect(() => {
    const trackingKey = `${workspaceId}-${agentId}-${grain}-${queryText.trim()}`;
    if (data && !isLoading && (!hasTrackedMemory.current || lastTrackedKey.current !== trackingKey)) {
      const resultCount = Array.isArray(data) ? data.length : (data.records?.length || 0);
      trackEvent("agent_memory_viewed", {
        workspace_id: workspaceId,
        agent_id: agentId,
        grain,
        has_query: queryText.trim().length > 0,
        result_count: resultCount,
      });
      hasTrackedMemory.current = true;
      lastTrackedKey.current = trackingKey;
    }
    if (isLoading) {
      hasTrackedMemory.current = false;
    }
  }, [data, isLoading, workspaceId, agentId, grain, queryText]);

  useEffect(() => {
    setExpandedRecordIds({});
    setFullContentById({});
    setLoadingRecordIds({});
    setRecordErrors({});
  }, [data, grain, queryText, minimumDaysAgo, maximumDaysAgo, maxResults]);

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const handleCopyContent = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Memory copied to clipboard");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to copy memory"
      );
    }
  };

  const formatPreviewContent = (content: string) => {
    return content.replace(/\r?\n/g, "\\n");
  };

  const handleToggleRecord = async (
    recordId: string,
    shouldLoadFull = false
  ) => {
    const isExpanded = Boolean(expandedRecordIds[recordId]);
    if (isExpanded) {
      setExpandedRecordIds((prev) => ({ ...prev, [recordId]: false }));
      return;
    }

    setExpandedRecordIds((prev) => ({ ...prev, [recordId]: true }));

    if (!shouldLoadFull || fullContentById[recordId]) {
      return;
    }

    setLoadingRecordIds((prev) => ({ ...prev, [recordId]: true }));
    setRecordErrors((prev) => ({ ...prev, [recordId]: "" }));

    try {
      const response = await getAgentMemoryRecord(
        workspaceId,
        agentId,
        recordId,
        grain
      );
      setFullContentById((prev) => ({
        ...prev,
        [recordId]: response.record.content,
      }));
    } catch (fetchError) {
      setRecordErrors((prev) => ({
        ...prev,
        [recordId]:
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load memory record",
      }));
    } finally {
      setLoadingRecordIds((prev) => ({ ...prev, [recordId]: false }));
    }
  };

  const grainOptions: TemporalGrain[] = [
    "working",
    "daily",
    "weekly",
    "monthly",
    "quarterly",
    "yearly",
  ];

  const grainLabels: Record<TemporalGrain, string> = {
    working: "Working Memory (Raw Facts)",
    daily: "Daily Summaries",
    weekly: "Weekly Summaries",
    monthly: "Monthly Summaries",
    quarterly: "Quarterly Summaries",
    yearly: "Yearly Summaries",
  };

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
          Search and browse the agent&apos;s memory records across different
          temporal grains. Working memory contains the most recent, detailed
          facts, while higher-level grains contain progressively summarized
          information.
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
              Temporal Grain
            </label>
            <select
              value={grain}
              onChange={(e) => setGrain(e.target.value as TemporalGrain)}
              className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
            >
              {grainOptions.map((g) => (
                <option key={g} value={g}>
                  {grainLabels[g]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Slider
              label="Max Results"
              value={maxResults}
              min={1}
              max={200}
              step={1}
              onChange={(value) => setMaxResults(value ?? 50)}
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold dark:text-neutral-300">
            Search Query (Optional)
          </label>
          <p className="mb-2 text-xs text-neutral-600 dark:text-neutral-300">
            Enter a search query for semantic search. Leave empty to browse
            recent records filtered by date range.
          </p>
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="e.g., React project discussion"
            className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Slider
              label="Minimum Days Ago"
              value={minimumDaysAgo}
              min={0}
              max={365}
              step={1}
              onChange={(value) => setMinimumDaysAgo(value ?? 0)}
            />
          </div>

          <div>
            <Slider
              label="Maximum Days Ago"
              value={maximumDaysAgo}
              min={0}
              max={365}
              step={1}
              onChange={(value) => setMaximumDaysAgo(value ?? 365)}
            />
          </div>
        </div>

        {minimumDaysAgo > maximumDaysAgo && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
            <p className="text-xs font-medium text-red-800 dark:text-red-200">
              Warning: Minimum days ago must be less than or equal to maximum
              days ago.
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={() => refetch()}
            disabled={isRefetching || minimumDaysAgo > maximumDaysAgo}
            className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRefetching ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* Results */}
      {isLoading && !data && (
        <div className="py-8 text-center">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">Loading memory records...</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <div className="text-sm font-semibold text-red-800 dark:text-red-200">Error</div>
          <div className="mt-1 text-xs text-red-700 dark:text-red-300">
            {error instanceof Error
              ? error.message
              : "Failed to load memory records"}
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
              Memory Records ({data.records.length})
            </h3>
          </div>

          <ScrollContainer ref={scrollRef} maxHeight="min(60vh, 500px)">
            <VirtualList<AgentMemoryResult>
              scrollRef={scrollRef}
              items={data.records}
              estimateSize={() => 160}
              getItemKey={(index, record) =>
                record.id ?? `${record.timestamp}-${index}`
              }
              renderRow={(record) => (
                <div className="rounded-xl border-2 border-neutral-300 bg-white p-4 transition-all duration-200 hover:border-primary-400 hover:shadow-bold dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500">
                  <div className="mb-2 flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded border border-primary-200 bg-primary-100 px-2 py-1 text-xs font-semibold text-primary-800 dark:border-primary-800 dark:bg-primary-900 dark:text-primary-200">
                          {record.date}
                        </span>
                        <span className="text-xs text-neutral-500 dark:text-neutral-300">
                          {formatTimestamp(record.timestamp)}
                        </span>
                      </div>
                      {record.isTruncated && expandedRecordIds[record.id] && (
                        <div className="mb-2 flex items-center justify-start text-xs text-neutral-600 dark:text-neutral-300">
                          <button
                            type="button"
                            onClick={() => handleToggleRecord(record.id, true)}
                            className="font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                          >
                            Show less
                          </button>
                        </div>
                      )}
                      <div className="whitespace-pre-wrap break-words text-sm text-neutral-900 dark:text-neutral-50">
                        {expandedRecordIds[record.id] &&
                        fullContentById[record.id]
                          ? fullContentById[record.id]
                          : `${formatPreviewContent(record.content)}${
                              record.isTruncated ? "..." : ""
                            }`}
                      </div>
                      {record.isTruncated && !expandedRecordIds[record.id] && (
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-600 dark:text-neutral-300">
                          <button
                            type="button"
                            onClick={() => handleToggleRecord(record.id, true)}
                            className="font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                          >
                            Show more
                          </button>
                        </div>
                      )}
                      {record.isTruncated &&
                        expandedRecordIds[record.id] &&
                        (loadingRecordIds[record.id] ||
                          recordErrors[record.id]) && (
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-600 dark:text-neutral-300">
                            {loadingRecordIds[record.id] && (
                              <span>Loading full memory...</span>
                            )}
                            {recordErrors[record.id] && (
                              <span className="text-red-600 dark:text-red-300">
                                {recordErrors[record.id]}
                              </span>
                            )}
                          </div>
                        )}
                      {record.metadata &&
                        Object.keys(record.metadata).length > 0 && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs font-semibold text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-50">
                              Metadata
                            </summary>
                            <pre className="mt-1 overflow-x-auto rounded border border-neutral-200 bg-neutral-50 p-2 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                              {JSON.stringify(record.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                    </div>
                    <button
                      onClick={() =>
                        handleCopyContent(
                          fullContentById[record.id] ?? record.content
                        )
                      }
                      className="ml-4 whitespace-nowrap rounded-lg bg-gradient-primary px-3 py-1.5 text-xs font-semibold text-white transition-all duration-200 hover:shadow-colored"
                      title="Copy content"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
              empty={
                <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-900">
                  <p className="text-sm text-neutral-600 dark:text-neutral-300">
                    No memory records found for the selected filters.
                  </p>
                </div>
              }
            />
          </ScrollContainer>
        </>
      )}
    </div>
  );
};




