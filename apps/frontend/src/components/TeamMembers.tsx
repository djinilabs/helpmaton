import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useEffect, type FC } from "react";

import { useToast } from "../hooks/useToast";
import {
  useWorkspaceMembersInfinite,
  useWorkspaceInvitesInfinite,
} from "../hooks/useWorkspaceMembers";
import {
  removeWorkspaceMember,
  cancelWorkspaceInvite,
  type Member,
  type WorkspaceInviteListItem,
} from "../utils/api";
import { trackEvent } from "../utils/tracking";

import { LoadingScreen } from "./LoadingScreen";
import { ScrollContainer } from "./ScrollContainer";
import { VirtualList } from "./VirtualList";

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
    return "bg-accent-100 text-accent-700 border-accent-200 dark:bg-accent-900 dark:text-accent-300 dark:border-accent-700";
  return "bg-neutral-100 text-neutral-700 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:border-neutral-700";
};

export const TeamMembers: FC<TeamMembersProps> = ({
  workspaceId,
  canManage,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const membersScrollRef = useRef<HTMLDivElement>(null);
  const invitesScrollRef = useRef<HTMLDivElement>(null);

  const {
    data: membersData,
    isLoading: membersLoading,
    error: membersError,
    refetch: refetchMembers,
    isRefetching: isRefetchingMembers,
    hasNextPage: hasNextMembersPage,
    isFetchingNextPage: isFetchingNextMembers,
    fetchNextPage: fetchNextMembersPage,
  } = useWorkspaceMembersInfinite(workspaceId, 50);

  const {
    data: invitesData,
    isLoading: invitesLoading,
    error: invitesError,
    refetch: refetchInvites,
    isRefetching: isRefetchingInvites,
    hasNextPage: hasNextInvitesPage,
    isFetchingNextPage: isFetchingNextInvites,
    fetchNextPage: fetchNextInvitesPage,
  } = useWorkspaceInvitesInfinite(workspaceId, { enabled: canManage, pageSize: 50 });

  const removeMember = useMutation({
    mutationFn: (userId: string) => removeWorkspaceMember(workspaceId, userId),
    onSuccess: (_, userId) => {
      trackEvent("workspace_member_removed", {
        workspace_id: workspaceId,
        member_user_id: userId,
      });
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
    onSuccess: (_, inviteId) => {
      trackEvent("workspace_invite_deleted", {
        workspace_id: workspaceId,
        invite_id: inviteId,
      });
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

  if (membersLoading || (canManage && invitesLoading)) {
    return <LoadingScreen compact message="Loading..." />;
  }

  if (membersError) {
    return (
      <div className="text-error-600">
        Failed to load members:{" "}
        {membersError instanceof Error ? membersError.message : "Unknown error"}
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

  const members: Member[] =
    membersData?.pages.flatMap((p) => p.members) ?? [];
  const invites: WorkspaceInviteListItem[] =
    invitesData?.pages.flatMap((p) => p.invites) ?? [];

  return (
    <div className="space-y-6">
      {/* Refresh Button */}
      <div className="mb-4 flex justify-end">
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Pending Invitations */}
      {canManage && (
        <div>
          <h3 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            Pending Invitations
          </h3>
          <ScrollContainer
            ref={invitesScrollRef}
            maxHeight="min(40vh, 400px)"
          >
            <VirtualList<WorkspaceInviteListItem>
              scrollRef={invitesScrollRef}
              items={invites}
              estimateSize={() => 88}
              getItemKey={(_i, invite) => invite.inviteId}
              renderRow={(invite) => {
                const expiresAt = new Date(invite.expiresAt);
                const isExpiringSoon =
                  expiresAt.getTime() - now < 24 * 60 * 60 * 1000;

                return (
                  <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 p-4 last:border-b-0 dark:border-neutral-700 dark:bg-neutral-800">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <div className="font-semibold text-neutral-900 dark:text-neutral-50">
                          {invite.email}
                        </div>
                        <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
                          Invited{" "}
                          {new Date(invite.createdAt).toLocaleDateString()}
                          {" • "}
                          Expires {expiresAt.toLocaleDateString()}
                          {isExpiringSoon && (
                            <span className="ml-2 inline-block rounded-lg border border-error-200 bg-error-100 px-2 py-0.5 text-xs font-semibold text-error-800 dark:border-error-800 dark:bg-error-900 dark:text-error-200">
                              Expiring Soon
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${getPermissionColor(
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
                      className="rounded-lg px-4 py-2 text-sm font-semibold text-error-600 transition-colors hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-error-400 dark:hover:bg-error-900"
                    >
                      {cancelInvite.isPending ? "Cancelling..." : "Cancel"}
                    </button>
                  </div>
                );
              }}
              hasNextPage={hasNextInvitesPage ?? false}
              isFetchingNextPage={isFetchingNextInvites}
              fetchNextPage={fetchNextInvitesPage}
              empty={
                <div className="p-4 text-neutral-600 dark:text-neutral-300">
                  No pending invitations.
                </div>
              }
            />
          </ScrollContainer>
        </div>
      )}

      {/* Team Members */}
      <div>
        <h3 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          Team Members
        </h3>
        <ScrollContainer
          ref={membersScrollRef}
          maxHeight="min(50vh, 500px)"
        >
          <VirtualList<Member>
            scrollRef={membersScrollRef}
            items={members}
            estimateSize={() => 88}
            getItemKey={(_i, member) => member.userId}
            renderRow={(member) => (
              <div className="flex items-center justify-between border-b border-neutral-200 bg-white p-4 last:border-b-0 dark:border-neutral-700 dark:bg-neutral-900">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="font-semibold text-neutral-900 dark:text-neutral-50">
                      {member.email || `User ${member.userId.slice(0, 8)}`}
                    </div>
                    <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
                      Added {new Date(member.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${getPermissionColor(
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
                    className="rounded-lg px-4 py-2 text-sm font-semibold text-error-600 transition-colors hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-error-400 dark:hover:bg-error-900"
                  >
                    {removeMember.isPending ? "Removing..." : "Remove"}
                  </button>
                )}
              </div>
            )}
            hasNextPage={hasNextMembersPage ?? false}
            isFetchingNextPage={isFetchingNextMembers}
            fetchNextPage={fetchNextMembersPage}
            empty={
              <div className="p-4 text-neutral-600 dark:text-neutral-300">
                No members found in this workspace.
              </div>
            }
          />
        </ScrollContainer>
      </div>
    </div>
  );
};
