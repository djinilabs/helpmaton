#!/usr/bin/env node
/**
 * One-off: read each skills subdir SKILL.md and emit skills/<id>.ts that exports default AgentSkill.
 * Run from apps/backend: node scripts/generate-skill-modules.mjs
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "../src/skills");

function parseRequiredTools(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const result = [];
  for (const item of raw) {
    if (item && typeof item === "object" && item.type === "mcpService" && item.serviceType) {
      result.push({ type: "mcpService", serviceType: String(item.serviceType) });
    } else if (item && typeof item === "object" && item.type === "builtin" && item.tool) {
      result.push({ type: "builtin", tool: String(item.tool) });
    }
  }
  return result;
}

function escapeContent(s) {
  return JSON.stringify(s);
}

async function main() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    if (!/^[a-z0-9-]+$/.test(id)) continue;
    const mdPath = join(SKILLS_DIR, id, "SKILL.md");
    let raw;
    try {
      raw = await readFile(mdPath, "utf-8");
    } catch {
      continue;
    }
    const parsed = matter(raw);
    const data = parsed.data;
    const name = typeof data.name === "string" ? data.name.trim() : "";
    const description = typeof data.description === "string" ? data.description.trim() : "";
    const requiredTools = parseRequiredTools(data.requiredTools);
    if (!name || !description || requiredTools.length === 0) {
      console.warn(`Skipping ${id}: missing name, description, or requiredTools`);
      continue;
    }
    const role =
      typeof data.role === "string" && data.role.trim() !== ""
        ? data.role.trim()
        : undefined;
    const content = parsed.content.trim();
    const requiredToolsStr = JSON.stringify(requiredTools, null, 2).replace(/\n/g, "\n  ");
    const ts = `import type { AgentSkill } from "./skill";

const skill: AgentSkill = {
  id: ${JSON.stringify(id)},
  name: ${JSON.stringify(name)},
  description: ${JSON.stringify(description)},
  role: ${role ? JSON.stringify(role) : "undefined"},
  requiredTools: ${requiredToolsStr},
  content: ${escapeContent(content)},
};

export default skill;
`;
    const outPath = join(SKILLS_DIR, `${id}.ts`);
    await writeFile(outPath, ts, "utf-8");
    console.log(`Wrote ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
