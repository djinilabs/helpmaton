import { useState, lazy, Suspense, useEffect } from "react";
import type { FC } from "react";
import { Link } from "react-router-dom";

import { LoadingScreen } from "../components/LoadingScreen";
import { useEscapeKey } from "../hooks/useEscapeKey";
import {
  useUserApiKeys,
  useCreateUserApiKey,
  useDeleteUserApiKey,
} from "../hooks/useUserApiKeys";
import { trackEvent } from "../utils/tracking";

// Lazy load SubscriptionPanel
const SubscriptionPanel = lazy(() =>
  import("../components/SubscriptionPanel").then((module) => ({
    default: module.SubscriptionPanel,
  }))
);

const UserSettings: FC = () => {
  const { data: apiKeys } = useUserApiKeys();
  const createApiKeyMutation = useCreateUserApiKey();
  const deleteApiKeyMutation = useDeleteUserApiKey();
  const [newKeyName, setNewKeyName] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{
    id: string;
    key: string;
    name: string | null;
  } | null>(null);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await createApiKeyMutation.mutateAsync({
        name: newKeyName.trim() || undefined,
      });
      trackEvent("user_api_key_created", {
        key_id: result.id,
      });
      setNewlyCreatedKey({
        id: result.id,
        key: result.key,
        name: result.name,
      });
      setNewKeyName("");
      setShowCreateModal(false);
    } catch {
      // Error is handled by the mutation
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    if (
      !window.confirm(
        "Are you sure you want to delete this API key? This action cannot be undone."
      )
    ) {
      return;
    }
    try {
      await deleteApiKeyMutation.mutateAsync(keyId);
      trackEvent("user_api_key_deleted", {
        key_id: keyId,
      });
    } catch {
      // Error is handled by the mutation
    }
  };

  const handleCopyKey = (key: string, keyId: string) => {
    navigator.clipboard.writeText(key);
    setCopiedKeyId(keyId);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  useEscapeKey(showCreateModal, () => {
    setShowCreateModal(false);
    setNewKeyName("");
  });

  useEscapeKey(!!newlyCreatedKey, () => setNewlyCreatedKey(null));

  // Track user settings viewing
  useEffect(() => {
    trackEvent("user_settings_viewed", {});
  }, []);

  return (
    <div className="min-h-screen bg-gradient-soft p-6 dark:bg-gradient-soft-dark lg:p-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Suspense fallback={<LoadingScreen compact />}>
            <SubscriptionPanel />
          </Suspense>
        </div>

        <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-8 shadow-medium dark:border-neutral-700 dark:bg-neutral-900 lg:p-10">
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 lg:text-5xl">
            API Keys
          </h1>
          <p className="mb-6 text-lg text-neutral-600 dark:text-neutral-300">
            These API keys are used to authenticate requests to the{" "}
            <Link
              to="/docs/api"
              className="font-semibold text-primary-600 underline hover:text-primary-700"
            >
              Helpmaton API
            </Link>
            . Use these keys with the{" "}
            <code className="rounded bg-neutral-100 px-2 py-1 font-mono text-sm dark:bg-neutral-800 dark:text-neutral-50">
              Authorization: Bearer &lt;key&gt;
            </code>{" "}
            header.
          </p>

          <div className="mb-6 flex justify-end">
            <button
              onClick={() => setShowCreateModal(true)}
              className="rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:shadow-colored"
            >
              Create New Key
            </button>
          </div>

          {apiKeys.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-neutral-300 py-12 text-center">
              <p className="mb-4 text-neutral-600">
                You don&apos;t have any API keys yet.
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="rounded-xl bg-gradient-primary px-6 py-3 font-semibold text-white transition-colors hover:shadow-colored"
              >
                Create Your First Key
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {apiKeys.map((key) => (
                <div
                  key={key.id}
                  className="rounded-xl border border-neutral-200 p-6 transition-colors hover:border-neutral-300"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="mb-2 flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-neutral-900">
                          {key.name || "Unnamed Key"}
                        </h3>
                        <span className="rounded bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-600">
                          {key.maskedKey}
                        </span>
                      </div>
                      <div className="space-y-1 text-sm text-neutral-600">
                        <p>Created: {formatDate(key.createdAt)}</p>
                        {key.lastUsedAt && (
                          <p>Last used: {formatDate(key.lastUsedAt)}</p>
                        )}
                        {!key.lastUsedAt && (
                          <p className="italic text-neutral-400">Never used</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteKey(key.id)}
                      disabled={deleteApiKeyMutation.isPending}
                      className="rounded-xl px-4 py-2 font-medium text-error-600 transition-colors hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deleteApiKeyMutation.isPending
                        ? "Deleting..."
                        : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Key Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-large dark:border-neutral-700 dark:bg-neutral-900">
            <h2 className="mb-4 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              Create New API Key
            </h2>
            <form onSubmit={handleCreateKey}>
              <div className="mb-6">
                <label
                  htmlFor="keyName"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Name (optional)
                </label>
                <input
                  type="text"
                  id="keyName"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g., Production API, CI/CD"
                  className="w-full rounded-xl border border-neutral-300 px-4 py-2 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                />
                <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-300">
                  Give your key a descriptive name to help you identify it
                  later.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewKeyName("");
                  }}
                  className="flex-1 rounded-xl border border-neutral-300 px-4 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-50 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createApiKeyMutation.isPending}
                  className="flex-1 rounded-xl bg-gradient-primary px-4 py-2 font-medium text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {createApiKeyMutation.isPending
                    ? "Creating..."
                    : "Create Key"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Show Key Modal */}
      {newlyCreatedKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-large dark:border-neutral-700 dark:bg-neutral-900">
            <h2 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
              API Key Created
            </h2>
            <p className="mb-6 text-neutral-600 dark:text-neutral-300">
              Your API key has been created. Make sure to copy it now - you
              won&apos;t be able to see it again!
            </p>
            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                API Key
              </label>
              <div className="flex gap-2">
                <code className="flex-1 break-all rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-3 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50">
                  {newlyCreatedKey.key}
                </code>
                <button
                  onClick={() =>
                    handleCopyKey(newlyCreatedKey.key, newlyCreatedKey.id)
                  }
                  className="whitespace-nowrap rounded-xl bg-gradient-primary px-4 py-2 font-medium text-white transition-colors hover:shadow-colored"
                >
                  {copiedKeyId === newlyCreatedKey.id ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
            <div className="mb-6 rounded-xl border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Important:</strong> Store this key securely. It will not
                be shown again.
              </p>
            </div>
            <button
              onClick={() => setNewlyCreatedKey(null)}
              className="w-full rounded-xl bg-gradient-primary px-4 py-2 font-medium text-white transition-colors hover:shadow-colored"
            >
              I&apos;ve Saved My Key
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserSettings;
