import { useQuery } from "@tanstack/react-query";
import { useEffect, type FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { GroupedToolMetadata, McpServer } from "../utils/api";
import { getMcpServerTools } from "../utils/api";

interface McpServerToolsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  server: McpServer | null;
}

export const McpServerToolsDialog: FC<McpServerToolsDialogProps> = ({
  isOpen,
  onClose,
  workspaceId,
  server,
}) => {
  const { registerDialog, unregisterDialog } = useDialogTracking();

  useEscapeKey(isOpen, onClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const { data: groupedTools, isLoading: isLoadingTools } = useQuery({
    queryKey: ["mcp-server-tools", workspaceId, server?.id],
    queryFn: () => {
      if (!server?.id) {
        return Promise.resolve([] as GroupedToolMetadata[]);
      }
      return getMcpServerTools(workspaceId, server.id);
    },
    enabled: isOpen && !!server?.id,
    staleTime: 30 * 1000,
  });

  if (!isOpen) return null;

  if (isLoadingTools) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
        <div className="rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-neutral-700 dark:text-neutral-300">
            Loading tools...
          </p>
        </div>
      </div>
    );
  }

  const toolsGroup =
    groupedTools?.find((group) => group.category === "MCP Server Tools") ??
    groupedTools?.[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-4xl font-black text-neutral-900 dark:text-neutral-50">
              {server?.name ?? "Connected tool"} tools
            </h2>
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
              Tools may be marked as not available if OAuth is not connected.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-neutral-300 bg-white px-6 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
          >
            Close
          </button>
        </div>

        <div className="space-y-4">
          {!toolsGroup || toolsGroup.tools.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                No tools available for this server.
              </p>
            </div>
          ) : (
            toolsGroup.tools.map((tool) => (
              <div
                key={tool.name}
                className="rounded-lg border border-neutral-200 bg-white p-4 shadow-soft dark:border-neutral-700 dark:bg-neutral-900"
              >
                <div className="mb-2 flex items-start justify-between">
                  <code className="rounded border border-neutral-300 bg-neutral-100 px-2 py-1 font-mono text-lg font-semibold text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                    {tool.name}
                  </code>
                  {tool.alwaysAvailable ? (
                    <span className="rounded border border-green-300 bg-green-100 px-2 py-1 text-xs font-medium text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200">
                      Always Available
                    </span>
                  ) : (
                    <span
                      className={`rounded border px-2 py-1 text-xs font-medium ${
                        tool.condition?.includes("Available")
                          ? "border-green-300 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-900 dark:text-green-200"
                          : "border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200"
                      }`}
                    >
                      {tool.condition?.includes("Available")
                        ? "Available"
                        : "Not Available"}
                    </span>
                  )}
                </div>
                <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">
                  {tool.description}
                </p>
                {!tool.alwaysAvailable && tool.condition && (
                  <p
                    className={`mb-3 inline-block rounded border px-2 py-1 text-xs font-medium ${
                      tool.condition.includes("Available")
                        ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
                        : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                    }`}
                  >
                    {tool.condition}
                  </p>
                )}
                <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
                  <p className="mb-2 text-xs font-semibold text-neutral-900 dark:text-neutral-50">
                    Parameters:
                  </p>
                  {tool.parameters.length === 0 ? (
                    <p className="text-xs text-neutral-600 dark:text-neutral-300">
                      No parameters required.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {tool.parameters.map((param, index) => (
                        <div
                          key={index}
                          className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900"
                        >
                          <div className="mb-1 flex items-center gap-2">
                            <code className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 font-mono text-xs font-medium text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                              {param.name}
                            </code>
                            <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
                              {param.type}
                            </span>
                            {param.required ? (
                              <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:border-red-700 dark:bg-red-900 dark:text-red-200">
                                Required
                              </span>
                            ) : (
                              <span className="rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                Optional
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-neutral-600 dark:text-neutral-300">
                            {param.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
