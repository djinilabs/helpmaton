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
      <div className="border border-neutral-200 rounded-xl p-4 bg-white">
        <LoadingScreen compact message="Loading..." />
      </div>
    );
  }

  if (!connection) {
    return (
      <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-soft">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-neutral-900">
            Email Connection
          </h3>
          <button
            onClick={() => setIsModalOpen(true)}
            className="bg-gradient-primary px-4 py-2.5 text-white text-sm font-semibold rounded-xl hover:shadow-colored transition-colors"
          >
            Create
          </button>
        </div>
        <p className="text-sm text-neutral-600">
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
      <div className="border border-neutral-200 rounded-xl p-4 bg-white shadow-soft">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-neutral-900">
            Email Connection
          </h3>
          <div className="flex gap-2">
            <button
              onClick={() => setIsModalOpen(true)}
              className="border border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 transition-colors"
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
              className="bg-error-600 px-4 py-2.5 text-white text-sm font-semibold rounded-xl hover:bg-error-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deleteConnection.isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <div>
            <span className="text-sm font-medium text-neutral-700">Name:</span>{" "}
            <span className="text-sm text-neutral-900">{connection.name}</span>
          </div>
          <div>
            <span className="text-sm font-medium text-neutral-700">Type:</span>{" "}
            <span className="text-sm text-neutral-900">{connection.type}</span>
          </div>
          <div>
            <span className="text-sm font-medium text-neutral-700">
              Created:
            </span>{" "}
            <span className="text-sm text-neutral-900">
              {new Date(connection.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="mt-4 border border-neutral-200 rounded-xl p-4 bg-neutral-50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-neutral-900">
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
              className="border border-neutral-300 bg-white px-4 py-2 text-sm font-medium rounded-xl hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {testConnection.isPending ? "Testing..." : "Send Test Email"}
            </button>
          </div>
          <p className="text-xs mt-2 text-neutral-600">
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
