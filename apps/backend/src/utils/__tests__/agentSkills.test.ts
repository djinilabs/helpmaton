import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import {
  buildSystemPromptWithSkills,
  clearSkillsCache,
  getAvailableSkills,
  getAllSkills,
  groupSkillsByRole,
  loadSkillsFromFolder,
  type AgentForSkills,
  type McpServerForSkills,
} from "../agentSkills";

describe("agentSkills", () => {
  let skillsDir: string;

  beforeEach(async () => {
    clearSkillsCache();
    skillsDir = await mkdtemp(path.join(os.tmpdir(), "agent-skills-test-"));
  });

  afterEach(async () => {
    clearSkillsCache();
    try {
      await rm(skillsDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  async function writeSkill(
    id: string,
    frontmatter: Record<string, unknown>,
    content: string
  ) {
    const skillDir = path.join(skillsDir, id);
    await mkdir(skillDir, { recursive: true });
    const yaml = Object.entries(frontmatter)
      .map(([k, v]) => {
        if (Array.isArray(v)) {
          return (
            `${k}:\n` +
            v
              .map(
                (i: Record<string, string>) =>
                  `  - type: ${i.type}\n    ${i.type === "mcpService" ? "serviceType" : "tool"}: ${i.serviceType ?? i.tool}`
              )
              .join("\n")
          );
        }
        return `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`;
      })
      .join("\n");
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\n${yaml}\n---\n\n${content}`
    );
  }

  describe("loadSkillsFromFolder", () => {
    it("returns empty array when directory is empty", async () => {
      const skills = await loadSkillsFromFolder(skillsDir);
      expect(skills).toEqual([]);
    });

    it("parses valid SKILL.md with frontmatter and requiredTools", async () => {
      await writeSkill(
        "doc-faq",
        {
          name: "Document FAQ",
          description: "Answer from docs",
          role: "support",
          requiredTools: [{ type: "builtin", tool: "search_documents" }],
        },
        "Use document search to answer.\n"
      );
      const skills = await loadSkillsFromFolder(skillsDir);
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

    it("skips skill with empty requiredTools", async () => {
      await writeSkill(
        "no-tools",
        {
          name: "No Tools",
          description: "Invalid",
          requiredTools: [],
        },
        "Content"
      );
      const skills = await loadSkillsFromFolder(skillsDir);
      expect(skills).toHaveLength(0);
    });

    it("skips invalid folder names", async () => {
      await writeSkill(
        "Invalid_ID",
        {
          name: "Invalid",
          description: "Bad id",
          requiredTools: [{ type: "builtin", tool: "search_documents" }],
        },
        "Content"
      );
      const skills = await loadSkillsFromFolder(skillsDir);
      expect(skills).toHaveLength(0);
    });
  });

  describe("getAvailableSkills", () => {
    it("returns only skills whose builtin tool is enabled", async () => {
      await writeSkill(
        "doc-faq",
        {
          name: "Document FAQ",
          description: "From docs",
          requiredTools: [{ type: "builtin", tool: "search_documents" }],
        },
        "Content"
      );
      const agent: AgentForSkills = {
        enableSearchDocuments: true,
        enableMemorySearch: false,
        searchWebProvider: null,
        fetchWebProvider: null,
        enableExaSearch: false,
        enableSendEmail: false,
        enableImageGeneration: false,
      };
      const skills = await getAvailableSkills(agent, [], {
        skillsDir,
      });
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe("doc-faq");
    });

    it("excludes skill when builtin tool is disabled", async () => {
      await writeSkill(
        "doc-faq",
        {
          name: "Document FAQ",
          description: "From docs",
          requiredTools: [{ type: "builtin", tool: "search_documents" }],
        },
        "Content"
      );
      const agent: AgentForSkills = {
        enableSearchDocuments: false,
        enableMemorySearch: false,
        searchWebProvider: null,
        fetchWebProvider: null,
        enableExaSearch: false,
        enableSendEmail: false,
        enableImageGeneration: false,
      };
      const skills = await getAvailableSkills(agent, [], { skillsDir });
      expect(skills).toHaveLength(0);
    });

    it("includes skill when mcpService is enabled and OAuth connected", async () => {
      await writeSkill(
        "posthog-marketing",
        {
          name: "PostHog Marketing",
          description: "Analytics",
          requiredTools: [{ type: "mcpService", serviceType: "posthog" }],
        },
        "Use PostHog."
      );
      const agent: AgentForSkills = {};
      const mcpServers: McpServerForSkills[] = [
        { id: "s1", serviceType: "posthog", oauthConnected: false },
      ];
      const skills = await getAvailableSkills(agent, mcpServers, {
        skillsDir,
      });
      expect(skills).toHaveLength(1);
    });

    it("excludes skill when OAuth MCP service is not connected", async () => {
      await writeSkill(
        "notion-kb",
        {
          name: "Notion KB",
          description: "Notion",
          requiredTools: [{ type: "mcpService", serviceType: "notion" }],
        },
        "Use Notion."
      );
      const agent: AgentForSkills = {};
      const mcpServers: McpServerForSkills[] = [
        { id: "s1", serviceType: "notion", oauthConnected: false },
      ];
      const skills = await getAvailableSkills(agent, mcpServers, {
        skillsDir,
      });
      expect(skills).toHaveLength(0);
    });

    it("includes skill when OAuth MCP service is connected", async () => {
      await writeSkill(
        "notion-kb",
        {
          name: "Notion KB",
          description: "Notion",
          requiredTools: [{ type: "mcpService", serviceType: "notion" }],
        },
        "Use Notion."
      );
      const agent: AgentForSkills = {};
      const mcpServers: McpServerForSkills[] = [
        { id: "s1", serviceType: "notion", oauthConnected: true },
      ];
      const skills = await getAvailableSkills(agent, mcpServers, {
        skillsDir,
      });
      expect(skills).toHaveLength(1);
    });

    it("send_email skill requires hasEmailConnection", async () => {
      await writeSkill(
        "email-follow-up",
        {
          name: "Email Follow-up",
          description: "Email",
          requiredTools: [{ type: "builtin", tool: "send_email" }],
        },
        "Send emails."
      );
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
        skillsDir,
        hasEmailConnection: false,
      });
      expect(withoutEmail).toHaveLength(0);
      const withEmail = await getAvailableSkills(agent, [], {
        skillsDir,
        hasEmailConnection: true,
      });
      expect(withEmail).toHaveLength(1);
    });
  });

  describe("buildSystemPromptWithSkills", () => {
    beforeEach(async () => {
      await writeSkill(
        "skill-a",
        {
          name: "Skill A",
          description: "First",
          requiredTools: [{ type: "builtin", tool: "search_documents" }],
        },
        "Content A"
      );
      await writeSkill(
        "skill-b",
        {
          name: "Skill B",
          description: "Second",
          requiredTools: [{ type: "builtin", tool: "search_documents" }],
        },
        "Content B"
      );
    });

    it("returns base prompt unchanged when skillIds is empty", async () => {
      const result = await buildSystemPromptWithSkills("Base prompt", [], {
        skillsDir,
      });
      expect(result).toBe("Base prompt");
    });

    it("returns base prompt unchanged when skillIds is undefined", async () => {
      const result = await buildSystemPromptWithSkills("Base prompt", undefined, {
        skillsDir,
      });
      expect(result).toBe("Base prompt");
    });

    it("appends skill content in order and dedupes", async () => {
      const result = await buildSystemPromptWithSkills(
        "Base",
        ["skill-a", "skill-b", "skill-a"],
        { skillsDir }
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
      const result = await buildSystemPromptWithSkills(
        "Base",
        ["unknown-skill", "skill-a"],
        { skillsDir }
      );
      expect(result).toContain("Base");
      expect(result).toContain("Content A");
      expect(result).not.toContain("unknown-skill");
    });

    it("returns base prompt when all IDs are invalid", async () => {
      const result = await buildSystemPromptWithSkills(
        "Base",
        ["unknown-1", "unknown-2"],
        { skillsDir }
      );
      expect(result).toBe("Base");
    });
  });

  describe("groupSkillsByRole", () => {
    it("groups skills by role and puts missing role under other", () => {
      const skills = [
        {
          id: "a",
          name: "A",
          description: "A",
          requiredTools: [],
          content: "",
          role: "marketing",
        },
        {
          id: "b",
          name: "B",
          description: "B",
          requiredTools: [],
          content: "",
          role: "marketing",
        },
        {
          id: "c",
          name: "C",
          description: "C",
          requiredTools: [],
          content: "",
          role: "product",
        },
        {
          id: "d",
          name: "D",
          description: "D",
          requiredTools: [],
          content: "",
        },
      ] as Awaited<ReturnType<typeof loadSkillsFromFolder>>;
      const grouped = groupSkillsByRole(skills);
      expect(grouped.marketing).toHaveLength(2);
      expect(grouped.product).toHaveLength(1);
      expect(grouped.other).toHaveLength(1);
      expect(grouped.other![0].id).toBe("d");
    });
  });

  describe("lazy loading", () => {
    it("loads on first getAvailableSkills and uses cache on second call", async () => {
      await writeSkill(
        "doc-faq",
        {
          name: "Doc FAQ",
          description: "Docs",
          requiredTools: [{ type: "builtin", tool: "search_documents" }],
        },
        "Content"
      );
      const agent: AgentForSkills = {
        enableSearchDocuments: true,
        enableMemorySearch: false,
        searchWebProvider: null,
        fetchWebProvider: null,
        enableExaSearch: false,
        enableSendEmail: false,
        enableImageGeneration: false,
      };
      const first = await getAvailableSkills(agent, [], { skillsDir });
      const second = await getAvailableSkills(agent, [], { skillsDir });
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(second[0].id).toBe(first[0].id);
    });

    it("getAllSkills returns same skills as loadSkillsFromFolder", async () => {
      await writeSkill(
        "doc-faq",
        {
          name: "Doc FAQ",
          description: "Docs",
          requiredTools: [{ type: "builtin", tool: "search_documents" }],
        },
        "Content"
      );
      const loaded = await loadSkillsFromFolder(skillsDir);
      const all = await getAllSkills(skillsDir);
      expect(loaded).toHaveLength(1);
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(loaded[0].id);
    });
  });
});
