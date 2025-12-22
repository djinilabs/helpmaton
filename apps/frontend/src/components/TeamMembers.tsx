import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, type FC } from "react";

import { useToast } from "../hooks/useToast";
import {
  getWorkspaceMembers,
  removeWorkspaceMember,
  getWorkspaceInvites,
  cancelWorkspaceInvite,
  type Member,
  type WorkspaceInviteListItem,
} from "../utils/api";

import { LoadingScreen } from "./LoadingScreen";

interface TeamMembersProps {
  workspaceId: string;
  canManage: boolean; // true if user has OWNER permission
}

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

const getPermissionColor = (level: number): string => {
  if (level === PERMISSION_LEVELS.OWNER)
    return "bg-gradient-primary text-white";
  if (level === PERMISSION_LEVELS.WRITE)
    return "bg-accent-100 text-accent-700 border-accent-200";
  return "bg-neutral-100 text-neutral-700 border-neutral-200";
};

export const TeamMembers: FC<TeamMembersProps> = ({
  workspaceId,
  canManage,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    error,
    refetch: refetchMembers,
    isRefetching: isRefetchingMembers,
  } = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => getWorkspaceMembers(workspaceId),
  });

  const {
    data: invitesData,
    isLoading: invitesLoading,
    error: invitesError,
    refetch: refetchInvites,
    isRefetching: isRefetchingInvites,
  } = useQuery({
    queryKey: ["workspace-invites", workspaceId],
    queryFn: () => getWorkspaceInvites(workspaceId),
    enabled: canManage, // Only fetch invites if user can manage
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => removeWorkspaceMember(workspaceId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-members", workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-user-limit", workspaceId],
      });
      toast.success("Member removed from the workspace");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to remove member");
    },
  });

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) =>
      cancelWorkspaceInvite(workspaceId, inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-user-limit", workspaceId],
      });
      toast.success("Invitation cancelled");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to cancel invitation");
    },
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    refetchMembers();
    if (canManage) {
      refetchInvites();
    }
  };

  const isRefreshing = isRefetchingMembers || isRefetchingInvites;

  if (isLoading || (canManage && invitesLoading)) {
    return <LoadingScreen compact message="Loading..." />;
  }

  if (error) {
    return (
      <div className="text-error-600">
        Failed to load members:{" "}
        {error instanceof Error ? error.message : "Unknown error"}
      </div>
    );
  }

  if (invitesError && canManage) {
    return (
      <div className="text-error-600">
        Failed to load invitations:{" "}
        {invitesError instanceof Error ? invitesError.message : "Unknown error"}
      </div>
    );
  }

  const members = data?.members || [];
  const invites = invitesData?.invites || [];

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="flex justify-end mb-4">
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="border border-neutral-300 rounded-xl px-4 py-2.5 text-sm font-semibold bg-white text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Pending Invitations */}
      {canManage && invites.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-neutral-900 mb-4 dark:text-neutral-50">
            Pending Invitations
          </h3>
          <div className="space-y-3">
            {invites.map((invite: WorkspaceInviteListItem) => {
              const expiresAt = new Date(invite.expiresAt);
              const isExpiringSoon =
                expiresAt.getTime() - now < 24 * 60 * 60 * 1000; // Less than 24 hours

              return (
                <div
                  key={invite.inviteId}
                  className="flex items-center justify-between p-4 border border-neutral-200 rounded-xl bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <div className="font-semibold text-neutral-900 dark:text-neutral-50">
                        {invite.email}
                      </div>
                      <div className="text-sm text-neutral-500 mt-1 dark:text-neutral-300">
                        Invited{" "}
                        {new Date(invite.createdAt).toLocaleDateString()}
                        {" • "}
                        Expires {expiresAt.toLocaleDateString()}
                        {isExpiringSoon && (
                          <span className="text-error-600 font-medium ml-1 dark:text-error-400">
                            (expiring soon)
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${getPermissionColor(
                        invite.permissionLevel
                      )}`}
                    >
                      {getPermissionLabel(invite.permissionLevel)}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          `Are you sure you want to cancel the invitation to ${invite.email}?`
                        )
                      ) {
                        cancelInvite.mutate(invite.inviteId);
                      }
                    }}
                    disabled={cancelInvite.isPending}
                    className="px-4 py-2 text-sm font-semibold text-error-600 hover:bg-error-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:text-error-400 dark:hover:bg-error-950"
                  >
                    {cancelInvite.isPending ? "Cancelling..." : "Cancel"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Team Members */}
      <div>
        <h3 className="text-lg font-semibold text-neutral-900 mb-4 dark:text-neutral-50">
          Team Members
        </h3>
        {members.length === 0 ? (
          <div className="text-neutral-600 dark:text-neutral-300">
            No members found in this workspace.
          </div>
        ) : (
          <div className="space-y-3">
            {members.map((member: Member) => (
              <div
                key={member.userId}
                className="flex items-center justify-between p-4 border border-neutral-200 rounded-xl bg-white dark:border-neutral-700 dark:bg-neutral-900"
              >
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="font-semibold text-neutral-900 dark:text-neutral-50">
                      {member.email || `User ${member.userId.slice(0, 8)}`}
                    </div>
                    <div className="text-sm text-neutral-500 mt-1 dark:text-neutral-300">
                      Added {new Date(member.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${getPermissionColor(
                      member.permissionLevel
                    )}`}
                  >
                    {getPermissionLabel(member.permissionLevel)}
                  </span>
                </div>
                {canManage && (
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          `Are you sure you want to remove ${
                            member.email || "this member"
                          } from the workspace?`
                        )
                      ) {
                        removeMember.mutate(member.userId);
                      }
                    }}
                    disabled={removeMember.isPending}
                    className="px-4 py-2 text-sm font-semibold text-error-600 hover:bg-error-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:text-error-400 dark:hover:bg-error-950"
                  >
                    {removeMember.isPending ? "Removing..." : "Remove"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
