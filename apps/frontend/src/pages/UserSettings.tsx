import { useState, lazy, Suspense } from "react";
import type { FC } from "react";
import { Link } from "react-router-dom";

import { LoadingScreen } from "../components/LoadingScreen";
import {
  useUserApiKeys,
  useCreateUserApiKey,
  useDeleteUserApiKey,
} from "../hooks/useUserApiKeys";

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

  return (
    <div className="min-h-screen bg-gradient-soft p-6 lg:p-10">
      <div className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Suspense fallback={<LoadingScreen compact />}>
            <SubscriptionPanel />
          </Suspense>
        </div>

        <div className="bg-white rounded-2xl shadow-medium p-8 lg:p-10 border border-neutral-200 mb-6">
          <h1 className="text-4xl lg:text-5xl font-bold text-neutral-900 mb-2 tracking-tight">
            API Keys
          </h1>
          <p className="text-lg text-neutral-600 mb-6">
            These API keys are used to authenticate requests to the{" "}
            <Link
              to="/docs/api"
              className="text-primary-600 hover:text-primary-700 font-semibold underline"
            >
              Helpmaton API
            </Link>
            . Use these keys with the{" "}
            <code className="px-2 py-1 bg-neutral-100 rounded text-sm font-mono">
              Authorization: Bearer &lt;key&gt;
            </code>{" "}
            header.
          </p>

          <div className="flex justify-end mb-6">
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-gradient-primary text-white font-semibold rounded-xl hover:shadow-colored transition-colors shadow-sm"
            >
              Create New Key
            </button>
          </div>

          {apiKeys.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-neutral-300 rounded-xl">
              <p className="text-neutral-600 mb-4">
                You don&apos;t have any API keys yet.
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-6 py-3 bg-gradient-primary text-white font-semibold rounded-xl hover:shadow-colored transition-colors"
              >
                Create Your First Key
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {apiKeys.map((key) => (
                <div
                  key={key.id}
                  className="border border-neutral-200 rounded-xl p-6 hover:border-neutral-300 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-neutral-900">
                          {key.name || "Unnamed Key"}
                        </h3>
                        <span className="px-2 py-1 bg-neutral-100 text-neutral-600 text-xs font-mono rounded">
                          {key.maskedKey}
                        </span>
                      </div>
                      <div className="text-sm text-neutral-600 space-y-1">
                        <p>Created: {formatDate(key.createdAt)}</p>
                        {key.lastUsedAt && (
                          <p>Last used: {formatDate(key.lastUsedAt)}</p>
                        )}
                        {!key.lastUsedAt && (
                          <p className="text-neutral-400 italic">Never used</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteKey(key.id)}
                      disabled={deleteApiKeyMutation.isPending}
                      className="px-4 py-2 text-error-600 hover:bg-error-50 font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-large p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-neutral-900 mb-4">
              Create New API Key
            </h2>
            <form onSubmit={handleCreateKey}>
              <div className="mb-6">
                <label
                  htmlFor="keyName"
                  className="block text-sm font-medium text-neutral-700 mb-2"
                >
                  Name (optional)
                </label>
                <input
                  type="text"
                  id="keyName"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g., Production API, CI/CD"
                  className="w-full px-4 py-2 border border-neutral-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <p className="mt-2 text-sm text-neutral-500">
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
                  className="flex-1 px-4 py-2 border border-neutral-300 text-neutral-700 font-medium rounded-xl hover:bg-neutral-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createApiKeyMutation.isPending}
                  className="flex-1 px-4 py-2 bg-gradient-primary text-white font-medium rounded-xl hover:shadow-colored transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-large p-8 max-w-md w-full">
            <h2 className="text-2xl font-bold text-neutral-900 mb-2">
              API Key Created
            </h2>
            <p className="text-neutral-600 mb-6">
              Your API key has been created. Make sure to copy it now - you
              won&apos;t be able to see it again!
            </p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-neutral-700 mb-2">
                API Key
              </label>
              <div className="flex gap-2">
                <code className="flex-1 px-4 py-3 bg-neutral-100 border border-neutral-300 rounded-xl font-mono text-sm break-all">
                  {newlyCreatedKey.key}
                </code>
                <button
                  onClick={() =>
                    handleCopyKey(newlyCreatedKey.key, newlyCreatedKey.id)
                  }
                  className="px-4 py-2 bg-gradient-primary text-white font-medium rounded-xl hover:shadow-colored transition-colors whitespace-nowrap"
                >
                  {copiedKeyId === newlyCreatedKey.id ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
              <p className="text-sm text-yellow-800">
                <strong>Important:</strong> Store this key securely. It will not
                be shown again.
              </p>
            </div>
            <button
              onClick={() => setNewlyCreatedKey(null)}
              className="w-full px-4 py-2 bg-gradient-primary text-white font-medium rounded-xl hover:shadow-colored transition-colors"
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
