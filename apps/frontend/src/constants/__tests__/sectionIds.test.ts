import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

import {
  AGENT_SECTION_IDS,
  WORKSPACE_SECTION_IDS,
} from "../sectionIds";

/**
 * Verifies that section IDs used by suggestion "Go to X" links (suggestionActions.ts)
 * actually exist as id attributes in WorkspaceDetail and AgentDetail.
 * If you change an id in a page, update sectionIds.ts so this test stays green.
 */
describe("sectionIds", () => {
  const workspaceDetailPath = resolve(
    __dirname,
    "../../pages/WorkspaceDetail.tsx",
  );
  const agentDetailPath = resolve(__dirname, "../../pages/AgentDetail.tsx");

  it("WORKSPACE_SECTION_IDS values exist in WorkspaceDetail.tsx", () => {
    const content = readFileSync(workspaceDetailPath, "utf-8");
    for (const [name, id] of Object.entries(WORKSPACE_SECTION_IDS)) {
      expect(
        content.includes(`id="${id}"`) || content.includes(`id='${id}'`),
        `WORKSPACE_SECTION_IDS.${name} ("${id}") should appear as id in WorkspaceDetail.tsx`,
      ).toBe(true);
    }
  });

  it("AGENT_SECTION_IDS values exist in AgentDetail.tsx", () => {
    const content = readFileSync(agentDetailPath, "utf-8");
    for (const [name, id] of Object.entries(AGENT_SECTION_IDS)) {
      expect(
        content.includes(`id="${id}"`) || content.includes(`id='${id}'`),
        `AGENT_SECTION_IDS.${name} ("${id}") should appear as id in AgentDetail.tsx`,
      ).toBe(true);
    }
  });
});
