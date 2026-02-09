import { useState } from "react";
import type { FC } from "react";

import {
  useEmailConnection,
  useDeleteEmailConnection,
  useTestEmailConnection,
} from "../hooks/useEmailConnection";

import { EmailConnectionModal } from "./EmailConnectionModal";
import { LoadingScreen } from "./LoadingScreen";

interface EmailConnectionCardProps {
  workspaceId: string;
}

export const EmailConnectionCard: FC<EmailConnectionCardProps> = ({
  workspaceId,
}) => {
  const { data: connection, isLoading } = useEmailConnection(workspaceId);
  const deleteConnection = useDeleteEmailConnection(workspaceId);
  const testConnection = useTestEmailConnection(workspaceId);
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-surface-50">
        <LoadingScreen compact message="Loading..." />
      </div>
    );
  }

  if (!connection) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-soft dark:border-neutral-700 dark:bg-surface-50">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            Email Connection
          </h3>
          <button
            onClick={() => setIsModalOpen(true)}
            className="rounded-xl bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:shadow-colored"
          >
            Create
          </button>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          No email connection configured. Create one to enable email sending for
          agents.
        </p>
        <EmailConnectionModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          workspaceId={workspaceId}
        />
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-soft dark:border-neutral-700 dark:bg-surface-50">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            Email Connection
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setIsModalOpen(true)}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              Edit
            </button>
            <button
              onClick={async () => {
                if (
                  confirm(
                    "Are you sure you want to delete this email connection?"
                  )
                ) {
                  try {
                    await deleteConnection.mutateAsync();
                  } catch {
                    // Error is handled by toast in the hook
                  }
                }
              }}
              disabled={deleteConnection.isPending}
              className="rounded-xl bg-error-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-error-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleteConnection.isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Name:</span>{" "}
            <span className="text-sm text-neutral-900 dark:text-neutral-50">{connection.name}</span>
          </div>
          <div>
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Type:</span>{" "}
            <span className="text-sm text-neutral-900 dark:text-neutral-50">{connection.type}</span>
          </div>
          <div>
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Created:
            </span>{" "}
            <span className="text-sm text-neutral-900 dark:text-neutral-50">
              {new Date(connection.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-surface-100">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
              Test Connection
            </span>
            <button
              onClick={async () => {
                try {
                  await testConnection.mutateAsync();
                } catch {
                  // Error is handled by toast in the hook
                }
              }}
              disabled={testConnection.isPending}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              {testConnection.isPending ? "✨ Testing..." : "✨ Send Test Email"}
            </button>
          </div>
          <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
            Send a test email to verify your connection is working correctly.
          </p>
        </div>
      </div>
      <EmailConnectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        workspaceId={workspaceId}
        connection={connection}
      />
    </>
  );
};
