import { describe, expect, it } from "vitest";

import { buildKnowledgeGraphLayout } from "../knowledgeGraph";

describe("knowledgeGraph layout", () => {
  it("builds nodes and edges with degrees", () => {
    const layout = buildKnowledgeGraphLayout(
      [
        {
          id: "fact-1",
          source_id: "Alice",
          target_id: "Project X",
          label: "works_on",
        },
        {
          id: "fact-2",
          source_id: "Bob",
          target_id: "Project X",
          label: "leads",
        },
      ],
      { width: 200, height: 200, padding: 20 },
    );

    expect(layout.edges).toHaveLength(2);
    expect(layout.nodes.map((node) => node.id)).toEqual([
      "Alice",
      "Bob",
      "Project X",
    ]);

    const alice = layout.nodes.find((node) => node.id === "Alice");
    const project = layout.nodes.find((node) => node.id === "Project X");

    expect(alice?.degree).toBe(1);
    expect(project?.degree).toBe(2);
    expect(typeof alice?.x).toBe("number");
    expect(typeof alice?.y).toBe("number");
    expect(typeof project?.x).toBe("number");
    expect(typeof project?.y).toBe("number");
  });
});
