import type { FC } from "react";
import { useLocation, useParams, Link } from "react-router-dom";

import { useAgent } from "../hooks/useAgents";
import { useWorkspace } from "../hooks/useWorkspaces";

import { LoadingScreen } from "./LoadingScreen";
import { QueryPanel } from "./QueryPanel";

const WorkspaceLocationBar: FC<{ workspaceId: string }> = ({ workspaceId }) => {
  const { data: workspace } = useWorkspace(workspaceId);
  return (
    <>
      <Link
        to="/"
        className="text-neutral-600 hover:text-neutral-900 uppercase tracking-wide transition-colors border-b-2 border-transparent hover:border-neutral-900"
      >
        Home
      </Link>
      <span className="text-neutral-900 font-black">/</span>
      <Link
        to="/workspaces"
        className="text-neutral-600 hover:text-neutral-900 uppercase tracking-wide transition-colors border-b-2 border-transparent hover:border-neutral-900"
      >
        Workspaces
      </Link>
      <span className="text-neutral-900 font-black">/</span>
      <span className="text-neutral-900 uppercase tracking-wide">
        {workspace.name}
      </span>
    </>
  );
};

const AgentLocationBar: FC<{ workspaceId: string; agentId: string }> = ({
  workspaceId,
  agentId,
}) => {
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: agent } = useAgent(workspaceId, agentId);
  return (
    <>
      <Link
        to="/"
        className="text-neutral-600 hover:text-neutral-900 uppercase tracking-wide transition-colors border-b-2 border-transparent hover:border-neutral-900"
      >
        Home
      </Link>
      <span className="text-neutral-900 font-black">/</span>
      <Link
        to="/workspaces"
        className="text-neutral-600 hover:text-neutral-900 uppercase tracking-wide transition-colors border-b-2 border-transparent hover:border-neutral-900"
      >
        Workspaces
      </Link>
      <span className="text-neutral-900 font-black">/</span>
      <Link
        to={`/workspaces/${workspaceId}`}
        className="text-neutral-600 hover:text-neutral-900 uppercase tracking-wide transition-colors border-b-2 border-transparent hover:border-neutral-900"
      >
        {workspace.name}
      </Link>
      <span className="text-neutral-900 font-black">/</span>
      <span className="text-neutral-900 uppercase tracking-wide">
        {agent.name}
      </span>
    </>
  );
};

const LocationBarContent: FC = () => {
  const location = useLocation();
  const params = useParams<{
    id?: string;
    workspaceId?: string;
    agentId?: string;
  }>();

  const pathname = location.pathname;

  if (pathname === "/") {
    return (
      <Link to="/" className="text-neutral-900 uppercase tracking-wide">
        Home
      </Link>
    );
  }

  if (pathname === "/workspaces") {
    return (
      <>
        <Link
          to="/"
          className="text-neutral-600 hover:text-neutral-900 uppercase tracking-wide transition-colors border-b-2 border-transparent hover:border-neutral-900"
        >
          Home
        </Link>
        <span className="text-neutral-900 font-black">/</span>
        <span className="text-neutral-900 uppercase tracking-wide">
          Workspaces
        </span>
      </>
    );
  }

  // Check for agent detail page first (most specific)
  // Path pattern: /workspaces/:workspaceId/agents/:agentId
  if (pathname.startsWith("/workspaces/") && pathname.includes("/agents/")) {
    const workspaceId = params.workspaceId || pathname.split("/")[2];
    const agentId = params.agentId || pathname.split("/")[4];
    if (workspaceId && agentId) {
      return <AgentLocationBar workspaceId={workspaceId} agentId={agentId} />;
    }
  }

  // Check for workspace detail page (path like /workspaces/:id)
  // This matches /workspaces/:id but not /workspaces/:workspaceId/agents/:agentId or /workspaces/:workspaceId/email-oauth-callback
  if (
    pathname.startsWith("/workspaces/") &&
    !pathname.includes("/agents/") &&
    !pathname.includes("/email-oauth-callback") &&
    (params.id || pathname.split("/").length === 3)
  ) {
    const workspaceId = params.id || pathname.split("/")[2];
    if (workspaceId) {
      return <WorkspaceLocationBar workspaceId={workspaceId} />;
    }
  }

  // Fallback for other routes
  return (
    <Link
      to="/"
      className="text-neutral-600 hover:text-neutral-900 uppercase tracking-wide transition-colors border-b-2 border-transparent hover:border-neutral-900"
    >
      Home
    </Link>
  );
};

export const LocationBar: FC = () => {
  return (
    <nav className="border-b-4 border-neutral-900 bg-white sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-3">
        <div className="flex items-center gap-2 text-sm font-bold">
          <QueryPanel fallback={<LoadingScreen compact />}>
            <LocationBarContent />
          </QueryPanel>
        </div>
      </div>
    </nav>
  );
};
