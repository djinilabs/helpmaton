import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type FC, type PropsWithChildren } from "react";

import { useDialogTracking } from "../contexts/DialogContext";

// Use a ref to store the current dialog count so QueryClient can access it
const dialogCountRef = { current: 0 };

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors (client errors)
        if (
          error instanceof Error &&
          ["401", "403", "404", "410"].some((code) =>
            error.message.includes(code)
          )
        ) {
          return false;
        }
        // Retry once for other errors
        return failureCount < 1;
      },
      refetchOnWindowFocus: () => {
        // Don't refetch if any dialogs are open
        return dialogCountRef.current === 0;
      },
      throwOnError: true, // Required for Suspense error boundaries
    },
  },
});

export const QueryProvider: FC<PropsWithChildren> = ({ children }) => {
  const { dialogCount } = useDialogTracking();

  // Update the ref whenever dialog count changes
  useEffect(() => {
    dialogCountRef.current = dialogCount;
  }, [dialogCount]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};
