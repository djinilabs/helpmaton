import { useQuery } from "@tanstack/react-query";

import { getWorkspaceUserLimit, type WorkspaceUserLimit } from "../utils/api";

export function useWorkspaceUserLimit(workspaceId: string) {
  return useQuery<WorkspaceUserLimit>({
    queryKey: ["workspace-user-limit", workspaceId],
    queryFn: () => getWorkspaceUserLimit(workspaceId),
  });
}
