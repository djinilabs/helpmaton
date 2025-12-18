import { useState, type FC } from "react";

import { useAgentMemory } from "../hooks/useAgentMemory";
import type { TemporalGrain } from "../utils/api";

interface AgentMemoryRecordsProps {
  workspaceId: string;
  agentId: string;
}

export const AgentMemoryRecords: FC<AgentMemoryRecordsProps> = ({
  workspaceId,
  agentId,
}) => {
  const [grain, setGrain] = useState<TemporalGrain>("working");
  const [queryText, setQueryText] = useState("");
  const [minimumDaysAgo, setMinimumDaysAgo] = useState(0);
  const [maximumDaysAgo, setMaximumDaysAgo] = useState(365);
  const [maxResults, setMaxResults] = useState(50);

  const { data, isLoading, error, refetch, isRefetching } = useAgentMemory(
    workspaceId,
    agentId,
    {
      grain,
      queryText: queryText.trim().length > 0 ? queryText.trim() : undefined,
      minimumDaysAgo,
      maximumDaysAgo,
      maxResults,
    }
  );

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  const handleCopyContent = (content: string) => {
    navigator.clipboard.writeText(content);
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
        <p className="text-sm text-neutral-600 mb-4">
          Search and browse the agent&apos;s memory records across different
          temporal grains. Working memory contains the most recent, detailed
          facts, while higher-level grains contain progressively summarized
          information.
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-4 p-4 bg-neutral-50 border border-neutral-200 rounded-lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-2">
              Temporal Grain
            </label>
            <select
              value={grain}
              onChange={(e) => setGrain(e.target.value as TemporalGrain)}
              className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
            >
              {grainOptions.map((g) => (
                <option key={g} value={g}>
                  {grainLabels[g]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              Max Results
            </label>
            <input
              type="number"
              min="1"
              max="200"
              value={maxResults}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                if (!isNaN(value) && value > 0) {
                  setMaxResults(Math.min(value, 200));
                }
              }}
              className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Search Query (Optional)
          </label>
          <p className="text-xs text-neutral-600 mb-2">
            Enter a search query for semantic search. Leave empty to browse
            recent records filtered by date range.
          </p>
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="e.g., React project discussion"
            className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-2">
              Minimum Days Ago
            </label>
            <input
              type="number"
              min="0"
              value={minimumDaysAgo}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                if (!isNaN(value) && value >= 0) {
                  setMinimumDaysAgo(value);
                }
              }}
              className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              Maximum Days Ago
            </label>
            <input
              type="number"
              min="0"
              value={maximumDaysAgo}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                if (!isNaN(value) && value >= 0) {
                  setMaximumDaysAgo(value);
                }
              }}
              className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-2.5 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200"
            />
          </div>
        </div>

        {minimumDaysAgo > maximumDaysAgo && (
          <div className="border border-red-200 bg-red-50 rounded-xl p-3">
            <p className="text-xs font-medium text-red-800">
              Warning: Minimum days ago must be less than or equal to maximum
              days ago.
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={() => refetch()}
            disabled={isRefetching || minimumDaysAgo > maximumDaysAgo}
            className="bg-gradient-primary px-4 py-2.5 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {isRefetching ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* Results */}
      {isLoading && !data && (
        <div className="text-center py-8">
          <p className="text-sm text-neutral-600">Loading memory records...</p>
        </div>
      )}

      {error && (
        <div className="border border-red-200 bg-red-50 rounded-xl p-4">
          <div className="text-sm font-semibold text-red-800">Error</div>
          <div className="text-xs text-red-700 mt-1">
            {error instanceof Error
              ? error.message
              : "Failed to load memory records"}
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-neutral-900">
              Memory Records ({data.records.length})
            </h3>
          </div>

          {data.records.length === 0 ? (
            <div className="border border-neutral-200 rounded-xl p-6 bg-white text-center">
              <p className="text-sm text-neutral-600">
                No memory records found for the selected filters.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.records.map((record, index) => (
                <div
                  key={`${record.timestamp}-${index}`}
                  className="border-2 border-neutral-300 rounded-xl p-4 bg-white hover:shadow-bold hover:border-primary-400 transition-all duration-200"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold bg-primary-100 text-primary-800 px-2 py-1 rounded border border-primary-200">
                          {record.date}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {formatTimestamp(record.timestamp)}
                        </span>
                      </div>
                      <div className="text-sm text-neutral-900 whitespace-pre-wrap break-words">
                        {record.content}
                      </div>
                      {record.metadata &&
                        Object.keys(record.metadata).length > 0 && (
                          <details className="mt-2">
                            <summary className="text-xs font-semibold text-neutral-600 cursor-pointer hover:text-neutral-900">
                              Metadata
                            </summary>
                            <pre className="mt-1 text-xs bg-neutral-50 p-2 rounded border border-neutral-200 overflow-x-auto">
                              {JSON.stringify(record.metadata, null, 2)}
                            </pre>
                          </details>
                        )}
                    </div>
                    <button
                      onClick={() => handleCopyContent(record.content)}
                      className="ml-4 bg-gradient-primary px-3 py-1.5 text-white text-xs font-semibold rounded-lg hover:shadow-colored whitespace-nowrap transition-all duration-200"
                      title="Copy content"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};




