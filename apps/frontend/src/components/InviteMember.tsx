import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FC } from "react";

import { useToast } from "../hooks/useToast";
import { inviteWorkspaceMember } from "../utils/api";
import { trackEvent } from "../utils/tracking";

interface InviteMemberProps {
  workspaceId: string;
  canInvite?: boolean;
}

const PERMISSION_LEVELS = {
  READ: 1,
  WRITE: 2,
  OWNER: 3,
} as const;

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (email: string): boolean => {
  return email.trim().length > 0 && EMAIL_REGEX.test(email.trim());
};

export const InviteMember: FC<InviteMemberProps> = ({
  workspaceId,
  canInvite = true,
}) => {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [permissionLevel, setPermissionLevel] = useState<number>(
    PERMISSION_LEVELS.READ
  );

  const invite = useMutation({
    mutationFn: () =>
      inviteWorkspaceMember(workspaceId, email.trim(), permissionLevel),
    onSuccess: (result) => {
      trackEvent("workspace_member_invited", {
        workspace_id: workspaceId,
        invite_id: result.inviteId,
        permission_level: permissionLevel,
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-members", workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-user-limit", workspaceId],
      });
      setEmail("");
      setPermissionLevel(PERMISSION_LEVELS.READ);
      toast.success(`Invitation sent to ${email.trim()}`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to send invite");
    },
  });

  const isEmailValid = isValidEmail(email);
  const isSubmitDisabled = !canInvite || invite.isPending || !isEmailValid;
  const isDisabled = !canInvite || invite.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      toast.error("Please enter a valid email address");
      return;
    }
    invite.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!canInvite && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 font-semibold text-neutral-900 dark:border-amber-800 dark:bg-amber-950 dark:text-neutral-50">
          Cannot invite more users. User limit has been reached for your plan.
        </div>
      )}
      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Email Address
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400 dark:disabled:bg-neutral-800"
          required
          disabled={isDisabled}
        />
      </div>
      <div>
        <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Permission Level
        </label>
        <select
          value={permissionLevel}
          onChange={(e) => setPermissionLevel(Number(e.target.value))}
          className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400 dark:disabled:bg-neutral-800"
          disabled={isDisabled}
        >
          <option value={PERMISSION_LEVELS.READ}>Read - View only</option>
          <option value={PERMISSION_LEVELS.WRITE}>
            Write - Can make changes (cannot invite/remove users)
          </option>
          <option value={PERMISSION_LEVELS.OWNER}>
            Owner - Full access including invite/remove users
          </option>
        </select>
      </div>
      <button
        type="submit"
        disabled={isSubmitDisabled}
        className="rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
      >
        {invite.isPending ? "Sending..." : "Send Invitation"}
      </button>
    </form>
  );
};
