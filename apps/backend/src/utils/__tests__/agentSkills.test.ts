import { afterEach, beforeEach, describe, it, expect } from "vitest";

import type { AgentSkill } from "../../skills/skill";
import {
  buildSystemPromptWithSkills,
  clearSkillsCache,
  getAvailableSkills,
  getAllSkills,
  groupSkillsByRole,
  loadSkillsFromFolder,
  setSkillLoaderForTests,
  type AgentForSkills,
  type McpServerForSkills,
} from "../agentSkills";

function skill(
  overrides: Partial<AgentSkill> & { id: string; requiredTools: AgentSkill["requiredTools"] },
): AgentSkill {
  return {
    name: overrides.name ?? overrides.id,
    description: overrides.description ?? "",
    content: overrides.content ?? "",
    ...overrides,
  };
}

describe("agentSkills", () => {
  afterEach(() => {
    clearSkillsCache();
  });

  describe("loadSkillsFromFolder", () => {
    it("returns empty array when loader returns empty", async () => {
      setSkillLoaderForTests(() => Promise.resolve([]));
      const skills = await loadSkillsFromFolder();
      expect(skills).toEqual([]);
    });

    it("returns skills from loader with frontmatter-like fields", async () => {
      const docFaq = skill({
        id: "doc-faq",
        name: "Document FAQ",
        description: "Answer from docs",
        role: "support",
        requiredTools: [{ type: "builtin", tool: "search_documents" }],
        content: "Use document search to answer.\n",
      });
      setSkillLoaderForTests(() => Promise.resolve([docFaq]));
      const skills = await loadSkillsFromFolder();
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe("doc-faq");
      expect(skills[0].name).toBe("Document FAQ");
      expect(skills[0].description).toBe("Answer from docs");
      expect(skills[0].role).toBe("support");
      expect(skills[0].requiredTools).toEqual([
        { type: "builtin", tool: "search_documents" },
      ]);
      expect(skills[0].content).toContain("Use document search");
    });

  });

  describe("getAvailableSkills", () => {
    it("returns only skills whose builtin tool is enabled", async () => {
      const docFaq = skill({
        id: "doc-faq",
        name: "Document FAQ",
        description: "From docs",
        requiredTools: [{ type: "builtin", tool: "search_documents" }],
        content: "Content",
      });
      setSkillLoaderForTests(() => Promise.resolve([docFaq]));
      const agent: AgentForSkills = {
        enableSearchDocuments: true,
        enableMemorySearch: false,
        searchWebProvider: null,
        fetchWebProvider: null,
        enableExaSearch: false,
        enableSendEmail: false,
        enableImageGeneration: false,
      };
      const skills = await getAvailableSkills(agent, []);
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe("doc-faq");
    });

    it("excludes skill when builtin tool is disabled", async () => {
      const docFaq = skill({
        id: "doc-faq",
        name: "Document FAQ",
        description: "From docs",
        requiredTools: [{ type: "builtin", tool: "search_documents" }],
        content: "Content",
      });
      setSkillLoaderForTests(() => Promise.resolve([docFaq]));
      const agent: AgentForSkills = {
        enableSearchDocuments: false,
        enableMemorySearch: false,
        searchWebProvider: null,
        fetchWebProvider: null,
        enableExaSearch: false,
        enableSendEmail: false,
        enableImageGeneration: false,
      };
      const skills = await getAvailableSkills(agent, []);
      expect(skills).toHaveLength(0);
    });

    it("includes skill when mcpService is enabled and OAuth connected", async () => {
      const posthogSkill = skill({
        id: "posthog-marketing",
        name: "PostHog Marketing",
        description: "Analytics",
        requiredTools: [{ type: "mcpService", serviceType: "posthog" }],
        content: "Use PostHog.",
      });
      setSkillLoaderForTests(() => Promise.resolve([posthogSkill]));
      const agent: AgentForSkills = {};
      const mcpServers: McpServerForSkills[] = [
        { id: "s1", serviceType: "posthog", oauthConnected: false },
      ];
      const skills = await getAvailableSkills(agent, mcpServers);
      expect(skills).toHaveLength(1);
    });

    it("excludes skill when OAuth MCP service is not connected", async () => {
      const notionSkill = skill({
        id: "notion-kb",
        name: "Notion KB",
        description: "Notion",
        requiredTools: [{ type: "mcpService", serviceType: "notion" }],
        content: "Use Notion.",
      });
      setSkillLoaderForTests(() => Promise.resolve([notionSkill]));
      const agent: AgentForSkills = {};
      const mcpServers: McpServerForSkills[] = [
        { id: "s1", serviceType: "notion", oauthConnected: false },
      ];
      const skills = await getAvailableSkills(agent, mcpServers);
      expect(skills).toHaveLength(0);
    });

    it("includes skill when OAuth MCP service is connected", async () => {
      const notionSkill = skill({
        id: "notion-kb",
        name: "Notion KB",
        description: "Notion",
        requiredTools: [{ type: "mcpService", serviceType: "notion" }],
        content: "Use Notion.",
      });
      setSkillLoaderForTests(() => Promise.resolve([notionSkill]));
      const agent: AgentForSkills = {};
      const mcpServers: McpServerForSkills[] = [
        { id: "s1", serviceType: "notion", oauthConnected: true },
      ];
      const skills = await getAvailableSkills(agent, mcpServers);
      expect(skills).toHaveLength(1);
    });

    it("send_email skill requires hasEmailConnection", async () => {
      const emailSkill = skill({
        id: "email-follow-up",
        name: "Email Follow-up",
        description: "Email",
        requiredTools: [{ type: "builtin", tool: "send_email" }],
        content: "Send emails.",
      });
      setSkillLoaderForTests(() => Promise.resolve([emailSkill]));
      const agent: AgentForSkills = {
        enableSendEmail: true,
        enableSearchDocuments: false,
        enableMemorySearch: false,
        searchWebProvider: null,
        fetchWebProvider: null,
        enableExaSearch: false,
        enableImageGeneration: false,
      };
      const withoutEmail = await getAvailableSkills(agent, [], {
        hasEmailConnection: false,
      });
      expect(withoutEmail).toHaveLength(0);
      const withEmail = await getAvailableSkills(agent, [], {
        hasEmailConnection: true,
      });
      expect(withEmail).toHaveLength(1);
    });
  });

  describe("buildSystemPromptWithSkills", () => {
    beforeEach(() => {
      setSkillLoaderForTests(() =>
        Promise.resolve([
          skill({
            id: "skill-a",
            name: "Skill A",
            description: "First",
            requiredTools: [{ type: "builtin", tool: "search_documents" }],
            content: "Content A",
          }),
          skill({
            id: "skill-b",
            name: "Skill B",
            description: "Second",
            requiredTools: [{ type: "builtin", tool: "search_documents" }],
            content: "Content B",
          }),
        ])
      );
    });

    it("returns base prompt unchanged when skillIds is empty", async () => {
      const result = await buildSystemPromptWithSkills("Base prompt", []);
      expect(result).toBe("Base prompt");
    });

    it("returns base prompt unchanged when skillIds is undefined", async () => {
      const result = await buildSystemPromptWithSkills("Base prompt", undefined);
      expect(result).toBe("Base prompt");
    });

    it("appends skill content in order and dedupes", async () => {
      const result = await buildSystemPromptWithSkills(
        "Base",
        ["skill-a", "skill-b", "skill-a"]
      );
      expect(result).toContain("Base");
      expect(result).toContain("## Enabled Skills");
      expect(result).toContain("Content A");
      expect(result).toContain("Content B");
      const aFirst = result.indexOf("Content A");
      const bFirst = result.indexOf("Content B");
      expect(aFirst).toBeLessThan(bFirst);
      expect(result.match(/Content A/g)).toHaveLength(1);
    });

    it("skips invalid skill IDs", async () => {
      const result = await buildSystemPromptWithSkills("Base", [
        "unknown-skill",
        "skill-a",
      ]);
      expect(result).toContain("Base");
      expect(result).toContain("Content A");
      expect(result).not.toContain("unknown-skill");
    });

    it("returns base prompt when all IDs are invalid", async () => {
      const result = await buildSystemPromptWithSkills("Base", [
        "unknown-1",
        "unknown-2",
      ]);
      expect(result).toBe("Base");
    });
  });

  describe("groupSkillsByRole", () => {
    it("groups skills by role and puts missing role under other", () => {
      const skills: AgentSkill[] = [
        skill({
          id: "a",
          name: "A",
          description: "A",
          requiredTools: [],
          content: "",
          role: "marketing",
        }),
        skill({
          id: "b",
          name: "B",
          description: "B",
          requiredTools: [],
          content: "",
          role: "marketing",
        }),
        skill({
          id: "c",
          name: "C",
          description: "C",
          requiredTools: [],
          content: "",
          role: "product",
        }),
        skill({
          id: "d",
          name: "D",
          description: "D",
          requiredTools: [],
          content: "",
        }),
      ];
      const grouped = groupSkillsByRole(skills);
      expect(grouped.marketing).toHaveLength(2);
      expect(grouped.product).toHaveLength(1);
      expect(grouped.other).toHaveLength(1);
      expect(grouped.other![0].id).toBe("d");
    });
  });

  describe("lazy loading", () => {
    it("loads on first getAvailableSkills and uses cache on second call", async () => {
      const docFaq = skill({
        id: "doc-faq",
        name: "Doc FAQ",
        description: "Docs",
        requiredTools: [{ type: "builtin", tool: "search_documents" }],
        content: "Content",
      });
      setSkillLoaderForTests(() => Promise.resolve([docFaq]));
      const agent: AgentForSkills = {
        enableSearchDocuments: true,
        enableMemorySearch: false,
        searchWebProvider: null,
        fetchWebProvider: null,
        enableExaSearch: false,
        enableSendEmail: false,
        enableImageGeneration: false,
      };
      const first = await getAvailableSkills(agent, []);
      const second = await getAvailableSkills(agent, []);
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(second[0].id).toBe(first[0].id);
    });

    it("getAllSkills returns same skills as loadSkillsFromFolder", async () => {
      const docFaq = skill({
        id: "doc-faq",
        name: "Doc FAQ",
        description: "Docs",
        requiredTools: [{ type: "builtin", tool: "search_documents" }],
        content: "Content",
      });
      setSkillLoaderForTests(() => Promise.resolve([docFaq]));
      const loaded = await loadSkillsFromFolder();
      const all = await getAllSkills();
      expect(loaded).toHaveLength(1);
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(loaded[0].id);
    });
  });
});
