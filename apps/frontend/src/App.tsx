import { SessionProvider } from "next-auth/react";
import { BrowserRouter } from "react-router-dom";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { RequiresSession } from "./components/RequiresSession";
import { Toaster } from "./components/Toaster";
import { DialogProvider } from "./contexts/DialogContext";
import { PostHogProvider } from "./providers/PostHogProvider";
import { QueryProvider } from "./providers/QueryProvider";
import { AppRoutes } from "./Routes";

function App() {
  return (
    <ErrorBoundary>
      <SessionProvider basePath="/api/auth">
        <DialogProvider>
          <QueryProvider>
            <BrowserRouter>
              <PostHogProvider>
                <RequiresSession>
                  <AppRoutes />
                  <Toaster />
                </RequiresSession>
              </PostHogProvider>
            </BrowserRouter>
          </QueryProvider>
        </DialogProvider>
      </SessionProvider>
    </ErrorBoundary>
  );
}

export default App;
