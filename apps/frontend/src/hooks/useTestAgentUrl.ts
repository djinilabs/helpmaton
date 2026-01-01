import { useQuery } from "@tanstack/react-query";

import { getTestAgentUrl } from "../utils/api";

export function useTestAgentUrl() {
  return useQuery({
    queryKey: ["test-agent-url"],
    queryFn: async () => {
      try {
        return await getTestAgentUrl();
      } catch (error) {
        // If there's any error (network, parsing, etc.), return null instead of throwing
        // This prevents the error boundary from catching it
        console.warn("[useTestAgentUrl] Error fetching test agent URL:", error);
        return null;
      }
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: false, // Don't retry on 404 errors (URL not configured)
    throwOnError: false, // Don't throw errors to error boundary - handle gracefully
  });
}

