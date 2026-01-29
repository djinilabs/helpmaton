import {
  useId,
  useMemo,
  useRef,
  useState,
  type FC,
  type MouseEvent,
} from "react";

import { useAgentKnowledgeGraph } from "../hooks/useAgentKnowledgeGraph";
import type { KnowledgeGraphFact } from "../utils/api";
import {
  buildKnowledgeGraphLayout,
  type KnowledgeGraphEdge,
  type KnowledgeGraphNode,
} from "../utils/knowledgeGraph";

import { Slider } from "./Slider";

interface AgentKnowledgeGraphProps {
  workspaceId: string;
  agentId: string;
  memoryExtractionEnabled: boolean;
}

type HoveredNode = KnowledgeGraphNode & { screenX: number; screenY: number };

const DEFAULT_MAX_RESULTS = 200;

export const AgentKnowledgeGraph: FC<AgentKnowledgeGraphProps> = ({
  workspaceId,
  agentId,
  memoryExtractionEnabled,
}) => {
  const [queryText, setQueryText] = useState("");
  const [appliedQueryText, setAppliedQueryText] = useState("");
  const [maxResults, setMaxResults] = useState(DEFAULT_MAX_RESULTS);
  const [appliedMaxResults, setAppliedMaxResults] = useState(
    DEFAULT_MAX_RESULTS,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<HoveredNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const markerIdRaw = useId();
  const markerId = useMemo(
    () => `arrow-${markerIdRaw.replace(/:/g, "-")}`,
    [markerIdRaw],
  );
  const panStateRef = useRef({
    isPanning: false,
    lastX: 0,
    lastY: 0,
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const effectiveQueryText =
    appliedQueryText.trim().length > 0 ? appliedQueryText.trim() : undefined;

  const { data, isLoading, error, refetch, isRefetching } =
    useAgentKnowledgeGraph(workspaceId, agentId, {
      queryText: effectiveQueryText,
      maxResults: appliedMaxResults,
    });

  const facts = useMemo(() => data?.facts ?? [], [data?.facts]);

  const layout = useMemo(
    () => buildKnowledgeGraphLayout(facts),
    [facts],
  );

  const edgesByNode = useMemo(() => {
    const map = new Map<string, KnowledgeGraphEdge[]>();
    for (const edge of layout.edges) {
      const add = (nodeId: string) => {
        const existing = map.get(nodeId) ?? [];
        existing.push(edge);
        map.set(nodeId, existing);
      };
      add(edge.source);
      add(edge.target);
    }
    return map;
  }, [layout.edges]);

  const resolvedSelectedNodeId = useMemo(() => {
    if (!selectedNodeId) return null;
    return layout.nodes.some((node) => node.id === selectedNodeId)
      ? selectedNodeId
      : null;
  }, [layout.nodes, selectedNodeId]);

  const activeNodeId = resolvedSelectedNodeId ?? hoveredNode?.id ?? null;
  const connectedEdgeIds = useMemo(() => {
    if (!activeNodeId) return new Set<string>();
    const edges = edgesByNode.get(activeNodeId) ?? [];
    return new Set(edges.map((edge) => edge.id));
  }, [activeNodeId, edgesByNode]);

  const connectedNodeIds = useMemo(() => {
    if (!activeNodeId) return new Set<string>();
    const edges = edgesByNode.get(activeNodeId) ?? [];
    const ids = new Set<string>();
    ids.add(activeNodeId);
    for (const edge of edges) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
    return ids;
  }, [activeNodeId, edgesByNode]);

  const handleSearch = () => {
    setAppliedQueryText(queryText.trim());
    setAppliedMaxResults(maxResults);
    void refetch();
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleNodeHover = (
    event: MouseEvent<SVGCircleElement>,
    node: KnowledgeGraphNode,
  ) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setHoveredNode({
      ...node,
      screenX: event.clientX - rect.left,
      screenY: event.clientY - rect.top,
    });
  };

  const handleNodeLeave = () => {
    setHoveredNode(null);
  };

  const relatedFacts: KnowledgeGraphFact[] = useMemo(() => {
    if (!activeNodeId) return facts;
    const edges = edgesByNode.get(activeNodeId) ?? [];
    const edgeIds = new Set(edges.map((edge) => edge.id));
    return facts.filter((fact) => edgeIds.has(fact.id));
  }, [activeNodeId, edgesByNode, facts]);

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          Visualize the facts extracted for this agent. Click a node to highlight
          connected relationships, and use search to filter results.
        </p>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Scroll to zoom. Drag the background to pan.
        </p>
      </div>

      {!memoryExtractionEnabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          This graph will populate once you enable memory extraction for the agent.
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="knowledge-graph-search"
              className="mb-2 block text-sm font-semibold dark:text-neutral-300"
            >
              Search facts (optional)
            </label>
            <input
              id="knowledge-graph-search"
              type="text"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="e.g., project name or person"
              className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
            />
          </div>
          <div>
            <Slider
              label="Max results"
              value={maxResults}
              min={1}
              max={500}
              step={1}
              onChange={(value) => setMaxResults(value ?? DEFAULT_MAX_RESULTS)}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={handleSearch}
            disabled={isRefetching}
            className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRefetching ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {isLoading && facts.length === 0 && (
        <div className="py-8 text-center">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            Loading knowledge graph...
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <div className="text-sm font-semibold text-red-800 dark:text-red-200">Error</div>
          <div className="mt-1 text-xs text-red-700 dark:text-red-300">
            {error instanceof Error ? error.message : "Failed to load graph facts"}
          </div>
        </div>
      )}

      {!isLoading && facts.length === 0 && !error && (
        <div className="rounded-xl border border-neutral-200 bg-white p-6 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-sm text-neutral-600 dark:text-neutral-300">
            No knowledge graph facts found for the current filters.
          </p>
        </div>
      )}

      {facts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr,1fr]">
          <div
            ref={containerRef}
            className="relative h-[520px] overflow-auto rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <div className="absolute right-4 top-4 z-10">
              <button
                type="button"
                onClick={handleResetView}
                className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                Reset view
              </button>
            </div>
            <svg
              ref={svgRef}
              width={layout.width}
              height={layout.height}
              viewBox={`${pan.x} ${pan.y} ${layout.width / zoom} ${
                layout.height / zoom
              }`}
              className="block select-none"
              onMouseMove={(event) => {
                if (!panStateRef.current.isPanning || !svgRef.current) {
                  return;
                }
                const rect = svgRef.current.getBoundingClientRect();
                const viewWidth = layout.width / zoom;
                const viewHeight = layout.height / zoom;
                const scaleX = viewWidth / rect.width;
                const scaleY = viewHeight / rect.height;
                const deltaX = event.clientX - panStateRef.current.lastX;
                const deltaY = event.clientY - panStateRef.current.lastY;
                panStateRef.current.lastX = event.clientX;
                panStateRef.current.lastY = event.clientY;
                setPan((current) => ({
                  x: current.x - deltaX * scaleX,
                  y: current.y - deltaY * scaleY,
                }));
              }}
              onMouseUp={() => {
                panStateRef.current.isPanning = false;
              }}
              onMouseLeave={() => {
                panStateRef.current.isPanning = false;
              }}
              onWheel={(event) => {
                if (!svgRef.current) return;
                event.preventDefault();
                const rect = svgRef.current.getBoundingClientRect();
                const viewWidth = layout.width / zoom;
                const viewHeight = layout.height / zoom;
                const cursorX = event.clientX - rect.left;
                const cursorY = event.clientY - rect.top;
                const cursorVX = pan.x + (cursorX * viewWidth) / rect.width;
                const cursorVY = pan.y + (cursorY * viewHeight) / rect.height;
                const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
                const nextZoom = Math.min(4, Math.max(0.5, zoom * zoomFactor));
                const nextViewWidth = layout.width / nextZoom;
                const nextViewHeight = layout.height / nextZoom;
                const nextPanX =
                  cursorVX - (cursorX * nextViewWidth) / rect.width;
                const nextPanY =
                  cursorVY - (cursorY * nextViewHeight) / rect.height;
                setZoom(nextZoom);
                setPan({ x: nextPanX, y: nextPanY });
              }}
            >
                <rect
                  x={pan.x}
                  y={pan.y}
                  width={layout.width / zoom}
                  height={layout.height / zoom}
                  fill="transparent"
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    panStateRef.current.isPanning = true;
                    panStateRef.current.lastX = event.clientX;
                    panStateRef.current.lastY = event.clientY;
                    setHoveredNode(null);
                  }}
                />
                <defs>
                  <marker
                  id={markerId}
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                  </marker>
                </defs>

                {layout.edges.map((edge) => {
                  const source = layout.nodes.find((node) => node.id === edge.source);
                  const target = layout.nodes.find((node) => node.id === edge.target);
                  if (!source || !target) return null;
                  const isActive =
                    activeNodeId && connectedEdgeIds.has(edge.id);
                  const strokeClass = isActive
                    ? "text-primary-500"
                    : "text-neutral-300 dark:text-neutral-700";
                  return (
                    <g key={edge.id}>
                      <line
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke="currentColor"
                        strokeWidth={isActive ? 2 : 1}
                        className={strokeClass}
                      markerEnd={`url(#${markerId})`}
                        opacity={isActive ? 1 : 0.7}
                      />
                      {isActive && (
                        <text
                          x={(source.x + target.x) / 2}
                          y={(source.y + target.y) / 2}
                          textAnchor="middle"
                          className="fill-primary-600 text-[10px] font-semibold dark:fill-primary-300"
                        >
                          {edge.label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {layout.nodes.map((node) => {
                  const isActive =
                    (activeNodeId && connectedNodeIds.has(node.id)) ||
                    (!activeNodeId && hoveredNode?.id === node.id);
                  const radius = Math.min(18, 6 + node.degree * 2);
                  return (
                    <g key={node.id}>
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={radius}
                        fill={isActive ? "rgb(99, 102, 241)" : "rgb(148, 163, 184)"}
                        className="cursor-pointer transition"
                        onMouseEnter={(event) => handleNodeHover(event, node)}
                        onMouseMove={(event) => handleNodeHover(event, node)}
                        onMouseLeave={handleNodeLeave}
                        onClick={() =>
                          setSelectedNodeId((current) =>
                            current === node.id ? null : node.id,
                          )
                        }
                      />
                      <text
                        x={node.x}
                        y={node.y - radius - 6}
                        textAnchor="middle"
                        className="fill-neutral-600 text-[10px] dark:fill-neutral-300"
                      >
                        {node.label.length > 16
                          ? `${node.label.slice(0, 16)}…`
                          : node.label}
                      </text>
                    </g>
                  );
                })}
            </svg>

            {hoveredNode && (
              <div
                className="pointer-events-none absolute z-20 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
                style={{
                  left: hoveredNode.screenX + 12,
                  top: hoveredNode.screenY + 12,
                }}
              >
                <div className="font-semibold text-neutral-900 dark:text-neutral-50">
                  {hoveredNode.label}
                </div>
                <div className="text-neutral-500 dark:text-neutral-400">
                  Connections: {hoveredNode.degree}
                </div>
              </div>
            )}
          </div>

          <div className="flex h-[520px] min-h-0 flex-col rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <div className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-50">
              {activeNodeId ? "Connected facts" : "Facts overview"}
            </div>
            <div className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
              Showing {Math.min(relatedFacts.length, 12)} of {relatedFacts.length}{" "}
              facts
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
              {relatedFacts.slice(0, 12).map((fact) => (
                <div
                  key={fact.id}
                  className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
                >
                  <span className="font-semibold">{fact.source_id}</span>{" "}
                  <span className="text-neutral-500 dark:text-neutral-400">
                    {fact.label}
                  </span>{" "}
                  <span className="font-semibold">{fact.target_id}</span>
                </div>
              ))}
              {relatedFacts.length === 0 && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                  No facts match the selected node.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
