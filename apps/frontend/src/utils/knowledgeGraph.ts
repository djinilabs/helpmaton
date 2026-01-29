import type { KnowledgeGraphFact } from "./api";

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  degree: number;
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface KnowledgeGraphLayout {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  width: number;
  height: number;
}

export interface KnowledgeGraphLayoutOptions {
  width?: number;
  height?: number;
  padding?: number;
}

export function buildKnowledgeGraphLayout(
  facts: KnowledgeGraphFact[],
  options: KnowledgeGraphLayoutOptions = {},
): KnowledgeGraphLayout {
  const width = options.width ?? 900;
  const height = options.height ?? 520;
  const padding = options.padding ?? 80;

  const nodeMap = new Map<
    string,
    { id: string; label: string; degree: number }
  >();
  const edges: KnowledgeGraphEdge[] = [];

  for (const fact of facts) {
    const source = fact.source_id;
    const target = fact.target_id;
    if (!nodeMap.has(source)) {
      nodeMap.set(source, { id: source, label: source, degree: 0 });
    }
    if (!nodeMap.has(target)) {
      nodeMap.set(target, { id: target, label: target, degree: 0 });
    }
    nodeMap.get(source)!.degree += 1;
    nodeMap.get(target)!.degree += 1;
    edges.push({
      id: fact.id,
      source,
      target,
      label: fact.label,
    });
  }

  const nodeIds = Array.from(nodeMap.keys()).sort((a, b) => a.localeCompare(b));
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(60, Math.min(width, height) / 2 - padding);

  const nodes: KnowledgeGraphNode[] = nodeIds.map((id, index) => {
    const angle =
      (2 * Math.PI * index) / Math.max(nodeIds.length, 1) - Math.PI / 2;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    const node = nodeMap.get(id)!;
    return {
      id,
      label: node.label,
      degree: node.degree,
      x,
      y,
    };
  });

  return {
    nodes,
    edges,
    width,
    height,
  };
}
