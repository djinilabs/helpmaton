/**
 * Skill type definitions. Shared by skill modules and agentSkills.
 */

export type RequiredTool =
  | { type: "mcpService"; serviceType: string }
  | { type: "builtin"; tool: string };

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  role?: string;
  requiredTools: RequiredTool[];
  content: string;
}
