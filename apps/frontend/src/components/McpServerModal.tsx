import { useState, useEffect } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import {
  useCreateMcpServer,
  useUpdateMcpServer,
  useMcpServer,
} from "../hooks/useMcpServers";
import { trackEvent } from "../utils/tracking";

interface McpServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  serverId?: string; // If provided, we're editing; otherwise, creating
}

export const McpServerModal: FC<McpServerModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  serverId,
}) => {
  const isEditing = !!serverId;
  const { data: server } = useMcpServer(workspaceId, serverId || "");
  const createServer = useCreateMcpServer(workspaceId);
  const updateServer = useUpdateMcpServer(workspaceId);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<"none" | "header" | "basic" | "oauth">("none");
  const [serviceType, setServiceType] = useState<"external" | "google-drive">("external");
  const [headerValue, setHeaderValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Reset form when modal opens/closes or server changes
  useEffect(() => {
    if (isOpen) {
      if (server) {
        setName(server.name);
        setUrl(server.url || "");
        setAuthType(server.authType);
        setServiceType(server.serviceType || "external");
        // Don't populate sensitive fields when editing
        setHeaderValue("");
        setUsername("");
        setPassword("");
      } else {
        setName("");
        setUrl("");
        setAuthType("none");
        setServiceType("external");
        setHeaderValue("");
        setUsername("");
        setPassword("");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, server?.id]);

  const handleClose = () => {
    setName("");
    setUrl("");
    setAuthType("none");
    setHeaderValue("");
    setUsername("");
    setPassword("");
    onClose();
  };

  const { registerDialog, unregisterDialog } = useDialogTracking();
  useEscapeKey(isOpen, handleClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    // URL is required for non-OAuth servers
    if (authType !== "oauth" && !url.trim()) return;
    // Service type is required for OAuth servers
    if (authType === "oauth" && serviceType === "external") return;

    // Validate auth config based on authType
    // When creating, auth fields are required
    // When editing, auth fields are optional (empty = keep existing value)
    if (!isEditing) {
      if (authType === "header" && !headerValue.trim()) {
        return;
      }
      if (authType === "basic" && (!username.trim() || !password.trim())) {
        return;
      }
    } else {
      // When editing, only require auth fields if auth type changed
      if (server) {
        if (authType !== server.authType) {
          // Auth type changed, so we need new credentials
          if (authType === "header" && !headerValue.trim()) {
            return;
          }
          if (authType === "basic" && (!username.trim() || !password.trim())) {
            return;
          }
        }
      }
    }

    try {
      const config: {
        headerValue?: string;
        username?: string;
        password?: string;
      } = {};

      if (authType === "header") {
        config.headerValue = headerValue.trim();
      } else if (authType === "basic") {
        config.username = username.trim();
        config.password = password.trim();
      }

      if (isEditing && serverId) {
        const updateData: {
          name?: string;
          url?: string;
          authType?: "none" | "header" | "basic" | "oauth";
          serviceType?: "external" | "google-drive";
          config?: typeof config;
        } = {
          name: name.trim(),
        };

        const updatedFields: string[] = [];
        if (name.trim() !== server?.name) {
          updatedFields.push("name");
        }

        // Only update fields that changed
        if (server && url !== (server.url || "")) {
          updateData.url = url.trim() || undefined;
          updatedFields.push("url");
        }
        if (server && authType !== server.authType) {
          updateData.authType = authType;
          updatedFields.push("auth_type");
        }
        if (server && serviceType !== (server.serviceType || "external")) {
          updateData.serviceType = serviceType;
          updatedFields.push("service_type");
        }
        // Only include config if:
        // 1. Auth type changed (need new credentials for new auth type)
        // 2. User provided new credentials (non-empty values)
        const authTypeChanged = server && authType !== server.authType;
        const hasNewCredentials =
          authType === "header"
            ? !!headerValue.trim()
            : authType === "basic"
            ? !!username.trim() && !!password.trim()
            : false;

        if (authTypeChanged || hasNewCredentials) {
          // If auth type changed, we need to build config for the new auth type
          if (authTypeChanged) {
            const newConfig: typeof config = {};
            if (authType === "header") {
              newConfig.headerValue = headerValue.trim();
            } else if (authType === "basic") {
              newConfig.username = username.trim();
              newConfig.password = password.trim();
            }
            // Only set config if authType is not "none"
            if (authType !== "none") {
              updateData.config = newConfig;
            }
          } else {
            // Auth type didn't change, use the config we built above
            // Only set config if authType is not "none"
            if (authType !== "none") {
              updateData.config = config;
            }
          }
          updatedFields.push("config");
        }
        // If neither condition is true, don't send config (will keep existing)

        await updateServer.mutateAsync({
          serverId,
          input: updateData,
        });
        trackEvent("mcp_server_updated", {
          workspace_id: workspaceId,
          server_id: serverId,
          server_name: name.trim(),
          updated_fields: updatedFields,
        });
      } else {
        // When creating, only send config if authType is not "none" or "oauth"
        const result = await createServer.mutateAsync({
          name: name.trim(),
          ...(authType !== "oauth" && url.trim() ? { url: url.trim() } : {}),
          authType,
          ...(authType === "oauth" ? { serviceType } : {}),
          ...(authType === "header" || authType === "basic" ? { config } : {}),
        });
        trackEvent("mcp_server_created", {
          workspace_id: workspaceId,
          server_id: result.id,
          auth_type: authType,
        });
      }
      handleClose();
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const isPending = isEditing ? updateServer.isPending : createServer.isPending;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-8 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {isEditing ? "Edit MCP Server" : "Create MCP Server"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Name *
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
            />
          </div>

          {authType !== "oauth" && (
            <div>
              <label
                htmlFor="url"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                URL *
              </label>
              <input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                placeholder="https://example.com/mcp"
                required
              />
            </div>
          )}

          <div>
            <label
              htmlFor="authType"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Authentication Type *
            </label>
            <select
              id="authType"
              value={authType}
              onChange={(e) => {
                const newAuthType = e.target.value as "none" | "header" | "basic" | "oauth";
                setAuthType(newAuthType);
                // Reset serviceType when switching away from OAuth
                if (newAuthType !== "oauth") {
                  setServiceType("external");
                } else {
                  // Default to google-drive when selecting OAuth
                  setServiceType("google-drive");
                }
              }}
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
            >
              <option value="none">None</option>
              <option value="header">Header (Authorization)</option>
              <option value="basic">HTTP Basic Auth</option>
              <option value="oauth">OAuth</option>
            </select>
          </div>

          {authType === "oauth" && (
            <div>
              <label
                htmlFor="serviceType"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Service Type *
              </label>
              <select
                id="serviceType"
                value={serviceType}
                onChange={(e) =>
                  setServiceType(e.target.value as "external" | "google-drive")
                }
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                required
              >
                <option value="external" disabled>Select a service...</option>
                <option value="google-drive">Google Drive</option>
              </select>
              <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                After creating the server, you&apos;ll need to connect your account via OAuth.
              </p>
            </div>
          )}

          {authType === "header" && (
            <div>
              <label
                htmlFor="headerValue"
                className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                Authorization Header Value {!isEditing ? "*" : ""}
              </label>
              <input
                id="headerValue"
                type="password"
                value={headerValue}
                onChange={(e) => setHeaderValue(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                placeholder={
                  isEditing
                    ? "Leave empty to keep existing value"
                    : "Bearer token123 or token123"
                }
                required={!isEditing && authType === "header"}
              />
              <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                {isEditing
                  ? "Leave empty to keep the existing value. Enter a new value to update it."
                  : "This value will be used in the Authorization header"}
              </p>
            </div>
          )}

          {authType === "basic" && (
            <>
              <div>
                <label
                  htmlFor="username"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Username {!isEditing ? "*" : ""}
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  placeholder={
                    isEditing ? "Leave empty to keep existing value" : ""
                  }
                  required={!isEditing && authType === "basic"}
                />
                {isEditing && (
                  <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                    Leave empty to keep the existing value. Enter a new value to
                    update it.
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Password {!isEditing ? "*" : ""}
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  placeholder={
                    isEditing ? "Leave empty to keep existing value" : ""
                  }
                  required={!isEditing && authType === "basic"}
                />
                {isEditing && (
                  <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                    Leave empty to keep the existing value. Enter a new value to
                    update it.
                  </p>
                )}
              </div>
            </>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending
                ? isEditing
                  ? "Updating..."
                  : "Creating..."
                : isEditing
                ? "Update"
                : "Create"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
