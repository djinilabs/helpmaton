import { SessionProvider } from "next-auth/react";
import { BrowserRouter } from "react-router-dom";

import { AppUpdateModal } from "./components/AppUpdateModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RequiresSession } from "./components/RequiresSession";
import { Toaster } from "./components/Toaster";
import { DialogProvider } from "./contexts/DialogContext";
import { useAppVersion } from "./hooks/useAppVersion";
import { PostHogProvider } from "./providers/PostHogProvider";
import { QueryProvider } from "./providers/QueryProvider";
import { AppRoutes } from "./Routes";
import { invalidateRootCache } from "./utils/serviceWorker";

function App() {
  const { currentVersion, latestVersion, isUpdateAvailable, dismissUpdate } =
    useAppVersion();

  const handleUpgrade = async () => {
    await invalidateRootCache();
    window.location.href = "/";
  };

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
                  <AppUpdateModal
                    isOpen={isUpdateAvailable}
                    currentVersion={currentVersion}
                    latestVersion={latestVersion}
                    onClose={dismissUpdate}
                    onUpgrade={handleUpgrade}
                  />
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
