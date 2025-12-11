import { useMutation } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useEffect, useState, type FC } from "react";
import { useParams, useNavigate } from "react-router-dom";

import { LoadingScreen } from "../components/LoadingScreen";
import { useToast } from "../hooks/useToast";
import {
  getWorkspaceInvite,
  acceptWorkspaceInvite,
  type WorkspaceInviteDetails,
} from "../utils/api";

const PERMISSION_LEVELS = {
  READ: 1,
  WRITE: 2,
  OWNER: 3,
} as const;

const getPermissionLabel = (level: number): string => {
  if (level === PERMISSION_LEVELS.OWNER) return "Owner";
  if (level === PERMISSION_LEVELS.WRITE) return "Write";
  return "Read";
};

export const InviteAccept: FC = () => {
  const { workspaceId, token } = useParams<{
    workspaceId: string;
    token: string;
  }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: session, status: sessionStatus } = useSession();
  const [invite, setInvite] = useState<WorkspaceInviteDetails | null>(null);
  const [loading, setLoading] = useState(!!workspaceId && !!token);
  const [error, setError] = useState<string | null>(
    !workspaceId || !token ? "Invalid invite link" : null
  );

  useEffect(() => {
    if (!workspaceId || !token) {
      return;
    }

    let cancelled = false;

    getWorkspaceInvite(workspaceId, token)
      .then((data) => {
        if (!cancelled) {
          setInvite(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || "Failed to load invite");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId, token]);

  const accept = useMutation({
    mutationFn: () => acceptWorkspaceInvite(workspaceId!, token!),
    onSuccess: (data) => {
      toast.success("You've been added to the workspace");
      // If callbackUrl is provided, redirect to it (for unauthenticated users)
      // This will trigger NextAuth's email verification flow, which will then redirect to the workspace
      if (data.callbackUrl) {
        window.location.href = data.callbackUrl;
      } else {
        // Authenticated user - just navigate to workspace
        navigate(`/workspaces/${workspaceId}`);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to accept invite");
    },
  });

  if (sessionStatus === "loading" || loading) {
    return <LoadingScreen message="Loading invite..." />;
  }

  if (error || !invite) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-soft p-8">
        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-large p-8 lg:p-10 border border-error-200">
          <h1 className="text-4xl font-semibold text-neutral-900 mb-4">
            Invalid Invite
          </h1>
          <p className="text-xl mb-6 text-error-600 font-semibold">
            {error || "This invite link is invalid or has expired."}
          </p>
          <button
            onClick={() => navigate("/workspaces")}
            className="bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
          >
            Go to Workspaces
          </button>
        </div>
      </div>
    );
  }

  // If user is not logged in, show invite details with accept button
  // The accept API will create the user if needed and send a magic link
  if (!session?.user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-soft p-8">
        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-large p-8 lg:p-10 border border-neutral-200">
          <h1 className="text-4xl font-semibold text-neutral-900 mb-4">
            Workspace Invitation
          </h1>
          <div className="space-y-4 mb-8">
            <div>
              <p className="text-sm text-neutral-600 mb-1">Workspace</p>
              <p className="text-xl font-semibold text-neutral-900">
                {invite.workspaceName}
              </p>
            </div>
            <div>
              <p className="text-sm text-neutral-600 mb-1">Permission Level</p>
              <p className="text-xl font-semibold text-neutral-900">
                {getPermissionLabel(invite.permissionLevel)}
              </p>
              <p className="text-sm text-neutral-600 mt-1">
                {invite.permissionLevel === PERMISSION_LEVELS.OWNER
                  ? "You can manage the workspace, invite and remove users, and make any changes."
                  : invite.permissionLevel === PERMISSION_LEVELS.WRITE
                  ? "You can make changes to the workspace, but cannot invite or remove users."
                  : "You can view the workspace, but cannot make changes."}
              </p>
            </div>
            {invite.inviterEmail && (
              <div>
                <p className="text-sm text-neutral-600 mb-1">Invited by</p>
                <p className="text-lg text-neutral-900">
                  {invite.inviterEmail}
                </p>
              </div>
            )}
            <div>
              <p className="text-sm text-neutral-600 mb-1">Email</p>
              <p className="text-lg text-neutral-900">{invite.email}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => accept.mutate()}
              disabled={accept.isPending}
              className="bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {accept.isPending ? "Accepting..." : "Accept Invitation"}
            </button>
            <button
              onClick={() => navigate("/workspaces")}
              disabled={accept.isPending}
              className="border border-neutral-300 bg-white px-6 py-3 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Check if user email matches invite email
  const userEmail = session.user.email?.toLowerCase();
  const inviteEmail = invite.email.toLowerCase();
  if (userEmail !== inviteEmail) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-soft p-8">
        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-large p-8 lg:p-10 border border-error-200">
          <h1 className="text-4xl font-semibold text-neutral-900 mb-4">
            Email Mismatch
          </h1>
          <p className="text-xl mb-6 text-error-600 font-semibold">
            This invitation was sent to {invite.email}, but you&apos;re signed
            in as {userEmail}.
          </p>
          <p className="text-base mb-6 text-neutral-600">
            Please sign in with the email address that received the invitation.
          </p>
          <button
            onClick={() => navigate("/api/auth/signin")}
            className="bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored transition-all duration-200"
          >
            Sign In with Different Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-soft p-8">
      <div className="max-w-2xl w-full bg-white rounded-2xl shadow-large p-8 lg:p-10 border border-neutral-200">
        <h1 className="text-4xl font-semibold text-neutral-900 mb-4">
          Workspace Invitation
        </h1>
        <div className="space-y-4 mb-8">
          <div>
            <p className="text-sm text-neutral-600 mb-1">Workspace</p>
            <p className="text-xl font-semibold text-neutral-900">
              {invite.workspaceName}
            </p>
          </div>
          <div>
            <p className="text-sm text-neutral-600 mb-1">Permission Level</p>
            <p className="text-xl font-semibold text-neutral-900">
              {getPermissionLabel(invite.permissionLevel)}
            </p>
            <p className="text-sm text-neutral-600 mt-1">
              {invite.permissionLevel === PERMISSION_LEVELS.OWNER
                ? "You can manage the workspace, invite and remove users, and make any changes."
                : invite.permissionLevel === PERMISSION_LEVELS.WRITE
                ? "You can make changes to the workspace, but cannot invite or remove users."
                : "You can view the workspace, but cannot make changes."}
            </p>
          </div>
          {invite.inviterEmail && (
            <div>
              <p className="text-sm text-neutral-600 mb-1">Invited by</p>
              <p className="text-lg text-neutral-900">{invite.inviterEmail}</p>
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => accept.mutate()}
            disabled={accept.isPending}
            className="bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {accept.isPending ? "Accepting..." : "Accept Invitation"}
          </button>
          <button
            onClick={() => navigate("/workspaces")}
            disabled={accept.isPending}
            className="border border-neutral-300 bg-white px-6 py-3 text-neutral-700 font-semibold rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default InviteAccept;
