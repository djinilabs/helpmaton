import { lazy, Suspense } from "react";
import type { FC } from "react";
import { Routes, Route } from "react-router-dom";

import { LoadingScreen } from "./components/LoadingScreen";

const Home = lazy(() => import("./pages/Home"));
const Workspaces = lazy(() => import("./pages/Workspaces"));
const WorkspaceDetail = lazy(() => import("./pages/WorkspaceDetail"));
const AgentDetail = lazy(() => import("./pages/AgentDetail"));
const EmailOAuthCallback = lazy(() => import("./pages/EmailOAuthCallback"));
const SubscriptionManagement = lazy(
  () => import("./pages/SubscriptionManagement")
);
const UserSettings = lazy(() => import("./pages/UserSettings"));
const InviteAccept = lazy(() => import("./pages/InviteAccept"));
const Integrations = lazy(() => import("./pages/Integrations"));
const ApiDocs = lazy(() => import("./pages/ApiDocs"));
const NotFound = lazy(() => import("./pages/NotFound"));

const RouteLoadingFallback: FC = () => {
  return <LoadingScreen />;
};

export const AppRoutes: FC = () => {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/workspaces" element={<Workspaces />} />
        <Route path="/workspaces/:id" element={<WorkspaceDetail />} />
        <Route
          path="/workspaces/:workspaceId/agents/:agentId"
          element={<AgentDetail />}
        />
        <Route
          path="/workspaces/:workspaceId/email-oauth-callback"
          element={<EmailOAuthCallback />}
        />
        <Route
          path="/workspaces/:workspaceId/invites/:token"
          element={<InviteAccept />}
        />
        <Route
          path="/workspaces/:workspaceId/integrations"
          element={<Integrations />}
        />
        <Route path="/subscription" element={<SubscriptionManagement />} />
        <Route path="/settings" element={<UserSettings />} />
        <Route path="/docs/api" element={<ApiDocs />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
};
