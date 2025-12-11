import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FC } from "react";

import { useToast } from "../hooks/useToast";
import { inviteWorkspaceMember } from "../utils/api";

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
    onSuccess: () => {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(email)) {
      toast.error("Please enter a valid email address");
      return;
    }
    invite.mutate();
  };

  const isEmailValid = isValidEmail(email);
  const isDisabled = !canInvite || invite.isPending || !isEmailValid;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!canInvite && (
        <div className="p-4 border border-amber-200 bg-amber-50 rounded-xl text-neutral-900 font-semibold">
          Cannot invite more users. User limit has been reached for your plan.
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-2">
          Email Address
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          className="w-full border border-neutral-300 rounded-xl bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-neutral-100"
          required
          disabled={isDisabled}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-2">
          Permission Level
        </label>
        <select
          value={permissionLevel}
          onChange={(e) => setPermissionLevel(Number(e.target.value))}
          className="w-full border border-neutral-300 rounded-xl bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-neutral-100"
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
        disabled={isDisabled}
        className="bg-gradient-primary px-6 py-3 text-white font-semibold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
      >
        {invite.isPending ? "Sending..." : "Send Invitation"}
      </button>
    </form>
  );
};
