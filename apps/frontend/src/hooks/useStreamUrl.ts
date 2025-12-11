import { useQuery } from "@tanstack/react-query";

import { getStreamUrl } from "../utils/api";

export function useStreamUrl() {
  return useQuery({
    queryKey: ["stream-url"],
    queryFn: async () => {
      try {
        return await getStreamUrl();
      } catch (error) {
        // If there's any error (network, parsing, etc.), return null instead of throwing
        // This prevents the error boundary from catching it
        console.warn("[useStreamUrl] Error fetching stream URL:", error);
        return null;
      }
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: false, // Don't retry on 404 errors (URL not configured)
    throwOnError: false, // Don't throw errors to error boundary - handle gracefully
  });
}
