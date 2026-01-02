import { useQuery } from "@tanstack/react-query";

import { getStreamUrl } from "../utils/api";

export function useTestAgentUrl() {
  return useQuery({
    queryKey: ["test-agent-url"],
    queryFn: async () => {
      // getStreamUrl already handles 404 by returning null
      // Other errors (500, network, etc.) will be thrown and exposed by React Query
      return await getStreamUrl();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: false, // Don't retry on errors
    throwOnError: false, // Don't throw errors to error boundary - handle in component
  });
}

