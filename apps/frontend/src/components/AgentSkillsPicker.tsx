import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";
import type { FC } from "react";
import { useState } from "react";

import type { AgentSkill, AgentSkillRequiredTool } from "../utils/api";

function formatRequiredTool(tool: AgentSkillRequiredTool): string {
  if (tool.type === "mcpService") {
    return tool.serviceType.charAt(0).toUpperCase() + tool.serviceType.slice(1);
  }
  const labels: Record<string, string> = {
    search_documents: "Document search",
    search_memory: "Memory search",
    search_web: "Web search",
    fetch_web: "Fetch web",
    exa_search: "Exa search",
    send_email: "Send email",
    image_generation: "Image generation",
  };
  return labels[tool.tool] ?? tool.tool;
}

export interface AgentSkillsPickerProps {
  skills: AgentSkill[];
  groupedByRole: Record<string, AgentSkill[]>;
  enabledSkillIds: string[];
  onToggle: (skillId: string) => void;
  onSave: () => void;
  isSaving: boolean;
  canEdit: boolean;
}

export const AgentSkillsPicker: FC<AgentSkillsPickerProps> = ({
  skills,
  groupedByRole,
  enabledSkillIds,
  onToggle,
  onSave,
  isSaving,
  canEdit,
}) => {
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);

  const roleOrder = ["marketing", "product", "support", "sales", "engineering", "other"];
  const keys = Object.keys(groupedByRole);
  const orderedRoles = [
    ...roleOrder.filter((r) => keys.includes(r)),
    ...keys.filter((k) => !roleOrder.includes(k)).sort(),
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {orderedRoles.map((role) => {
          const roleSkills = groupedByRole[role] ?? [];
          if (roleSkills.length === 0) return null;
          const roleLabel =
            role === "other"
              ? "Other"
              : role.charAt(0).toUpperCase() + role.slice(1);
          return (
            <div key={role}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                {roleLabel}
              </div>
              <div className="space-y-2">
                {roleSkills.map((skill) => {
                  const isEnabled = enabledSkillIds.includes(skill.id);
                  const isExpanded = expandedSkillId === skill.id;
                  return (
                    <div
                      key={skill.id}
                      className="rounded-lg border border-neutral-200 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-100 dark:hover:bg-neutral-800"
                    >
                      <label className="flex cursor-pointer items-start gap-2 p-3">
                        {canEdit && (
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => onToggle(skill.id)}
                            className="mt-1 rounded border-2 border-neutral-300 dark:border-neutral-600"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-bold dark:text-neutral-50">
                            {skill.name}
                          </div>
                          <div className="mt-0.5 text-sm opacity-80 dark:text-neutral-300">
                            {skill.description}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {skill.requiredTools.map((t, i) => (
                              <span
                                key={i}
                                className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
                              >
                                {formatRequiredTool(t)}
                              </span>
                            ))}
                          </div>
                        </div>
                      </label>
                      <div className="border-t border-neutral-200 dark:border-neutral-700">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={`skill-content-${skill.id}`}
                          aria-label={
                            isExpanded
                              ? `Hide content for ${skill.name}`
                              : `Show content for ${skill.name}`
                          }
                          id={`skill-toggle-${skill.id}`}
                          onClick={() =>
                            setExpandedSkillId(isExpanded ? null : skill.id)
                          }
                          className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-medium text-neutral-500 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800"
                        >
                          {isExpanded ? (
                            <ChevronUpIcon className="size-4" />
                          ) : (
                            <ChevronDownIcon className="size-4" />
                          )}
                          {isExpanded ? "Hide content" : "Show content"}
                        </button>
                        {isExpanded && (
                          <pre
                            id={`skill-content-${skill.id}`}
                            role="region"
                            aria-labelledby={`skill-toggle-${skill.id}`}
                            className="max-h-48 overflow-auto whitespace-pre-wrap border-t border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                          >
                            {skill.content}
                          </pre>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {canEdit && skills.length > 0 && (
        <button
          onClick={onSave}
          disabled={isSaving}
          className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save Skills"}
        </button>
      )}
    </div>
  );
};
