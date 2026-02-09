import { useState, useMemo, useEffect } from "react";
import type { FC } from "react";

import { useDialogTracking } from "../contexts/DialogContext";
import {
  useCreateOrUpdateEmailConnection,
  useUpdateEmailConnection,
  useTestEmailConnection,
  useInitiateOAuthFlow,
} from "../hooks/useEmailConnection";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { EmailConnection } from "../utils/api";

import { BrandName } from "./BrandName";

interface EmailConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  connection?: EmailConnection | null;
}

export const EmailConnectionModal: FC<EmailConnectionModalProps> = ({
  isOpen,
  onClose,
  workspaceId,
  connection,
}) => {
  const isEditing = !!connection;
  const createOrUpdate = useCreateOrUpdateEmailConnection(workspaceId);
  const update = useUpdateEmailConnection(workspaceId);
  const testConnection = useTestEmailConnection(workspaceId);
  const initiateOAuth = useInitiateOAuthFlow(workspaceId);
  const { registerDialog, unregisterDialog } = useDialogTracking();

  // Derive initial values from props when modal opens
  const initialValues = useMemo(() => {
    if (!isOpen) {
      return {
        type: "gmail" as const,
        name: "",
        smtpHost: "",
        smtpPort: "587",
        smtpSecure: true,
        smtpUsername: "",
        smtpPassword: "",
        smtpFromEmail: "",
      };
    }
    if (connection) {
      return {
        type: connection.type,
        name: connection.name,
        smtpHost: "",
        smtpPort: "587",
        smtpSecure: true,
        smtpUsername: "",
        smtpPassword: "",
        smtpFromEmail: "",
      };
    }
    return {
      type: "gmail" as const,
      name: "",
      smtpHost: "",
      smtpPort: "587",
      smtpSecure: true,
      smtpUsername: "",
      smtpPassword: "",
      smtpFromEmail: "",
    };
  }, [isOpen, connection]);

  const [type, setType] = useState<"gmail" | "outlook" | "smtp">(
    initialValues.type
  );
  const [name, setName] = useState(initialValues.name);
  const [smtpHost, setSmtpHost] = useState(initialValues.smtpHost);
  const [smtpPort, setSmtpPort] = useState(initialValues.smtpPort);
  const [smtpSecure, setSmtpSecure] = useState(initialValues.smtpSecure);
  const [smtpUsername, setSmtpUsername] = useState(initialValues.smtpUsername);
  const [smtpPassword, setSmtpPassword] = useState(initialValues.smtpPassword);
  const [smtpFromEmail, setSmtpFromEmail] = useState(
    initialValues.smtpFromEmail
  );

  // Update state when initial values change (modal opens/closes or connection changes)
  // This is a valid use case for resetting form state when modal opens
  useEffect(() => {
    if (isOpen) {
      setType(initialValues.type);
      setName(initialValues.name);
      setSmtpHost(initialValues.smtpHost);
      setSmtpPort(initialValues.smtpPort);
      setSmtpSecure(initialValues.smtpSecure);
      setSmtpUsername(initialValues.smtpUsername);
      setSmtpPassword(initialValues.smtpPassword);
      setSmtpFromEmail(initialValues.smtpFromEmail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, connection?.type, connection?.name]);

  const handleClose = () => {
    setName("");
    setSmtpHost("");
    setSmtpPort("587");
    setSmtpSecure(true);
    setSmtpUsername("");
    setSmtpPassword("");
    setSmtpFromEmail("");
    onClose();
  };

  useEscapeKey(isOpen, handleClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const handleOAuthConnect = async (provider: "gmail" | "outlook") => {
    try {
      await initiateOAuth.mutateAsync(provider);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleSMTPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (!isEditing) {
      if (
        !smtpHost.trim() ||
        !smtpPort.trim() ||
        !smtpUsername.trim() ||
        !smtpPassword.trim() ||
        !smtpFromEmail.trim()
      ) {
        return;
      }
    }

    try {
      const config = {
        host: smtpHost.trim(),
        port: parseInt(smtpPort, 10),
        secure: smtpSecure,
        username: smtpUsername.trim(),
        password: smtpPassword.trim(),
        fromEmail: smtpFromEmail.trim(),
      };

      if (isEditing) {
        const updateData: { name?: string; config?: Record<string, unknown> } =
          {
            name: name.trim(),
          };
        if (
          smtpHost.trim() ||
          smtpPort.trim() ||
          smtpUsername.trim() ||
          smtpPassword.trim() ||
          smtpFromEmail.trim()
        ) {
          updateData.config = config;
        }
        await update.mutateAsync(updateData);
      } else {
        await createOrUpdate.mutateAsync({
          type: "smtp",
          name: name.trim(),
          config,
        });
      }
      handleClose();
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const isPending = isEditing
    ? update.isPending
    : createOrUpdate.isPending || initiateOAuth.isPending;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-surface-50">
        <h2 className="mb-8 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
          {isEditing ? "Edit Email Connection" : "Create Email Connection"}
        </h2>
        <form onSubmit={handleSMTPSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="type"
              className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Provider *
            </label>
            <select
              id="type"
              value={type}
              onChange={(e) =>
                setType(e.target.value as "gmail" | "outlook" | "smtp")
              }
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
              disabled={isEditing}
            >
              <option value="gmail">Gmail (OAuth2)</option>
              <option value="outlook">Outlook (OAuth2)</option>
              <option value="smtp">SMTP</option>
            </select>
          </div>
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
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
              autoFocus
            />
          </div>

          {(type === "gmail" || type === "outlook") && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-surface-100">
              <p className="mb-4 text-sm text-neutral-700 dark:text-neutral-300">
                Connect your {type === "gmail" ? "Gmail" : "Outlook"} account
                using OAuth2. Click the button below to authorize <BrandName /> to
                send emails on your behalf.
              </p>
              <button
                type="button"
                onClick={() => handleOAuthConnect(type)}
                disabled={isPending || !name.trim()}
                className="w-full rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending
                  ? "Connecting..."
                  : `Connect ${type.charAt(0).toUpperCase() + type.slice(1)}`}
              </button>
              <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">
                You will be redirected to{" "}
                {type === "gmail" ? "Google" : "Microsoft"} to authorize the
                connection.
              </p>
            </div>
          )}

          {type === "smtp" && (
            <>
              <div>
                <label
                  htmlFor="smtpHost"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  SMTP Host {isEditing ? "(leave blank to keep current)" : "*"}
                </label>
                <input
                  id="smtpHost"
                  type="text"
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  required={!isEditing}
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div>
                <label
                  htmlFor="smtpPort"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  SMTP Port {isEditing ? "(leave blank to keep current)" : "*"}
                </label>
                <input
                  id="smtpPort"
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  required={!isEditing}
                  placeholder="587"
                />
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  Common ports: 587 (TLS), 465 (SSL), 25 (unencrypted)
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={smtpSecure}
                    onChange={(e) => setSmtpSecure(e.target.checked)}
                    className="mr-2"
                  />
                  Use Secure Connection (TLS/SSL)
                </label>
              </div>
              <div>
                <label
                  htmlFor="smtpUsername"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Username {isEditing ? "(leave blank to keep current)" : "*"}
                </label>
                <input
                  id="smtpUsername"
                  type="text"
                  value={smtpUsername}
                  onChange={(e) => setSmtpUsername(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  required={!isEditing}
                  placeholder="your-email@example.com"
                />
                <p className="mt-1.5 text-xs text-neutral-600 dark:text-neutral-300">
                  For accounts with 2FA, use an App Password instead of your
                  regular password.
                </p>
              </div>
              <div>
                <label
                  htmlFor="smtpPassword"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  Password {isEditing ? "(leave blank to keep current)" : "*"}
                </label>
                <input
                  id="smtpPassword"
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  required={!isEditing}
                  placeholder={
                    isEditing
                      ? "Enter new password to update"
                      : "Your password or app password"
                  }
                />
              </div>
              <div>
                <label
                  htmlFor="smtpFromEmail"
                  className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
                >
                  From Email {isEditing ? "(leave blank to keep current)" : "*"}
                </label>
                <input
                  id="smtpFromEmail"
                  type="email"
                  value={smtpFromEmail}
                  onChange={(e) => setSmtpFromEmail(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
                  required={!isEditing}
                  placeholder="sender@example.com"
                />
              </div>
            </>
          )}

          {isEditing && connection && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-surface-100">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                  Test Connection
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await testConnection.mutateAsync();
                    } catch {
                      // Error is handled by toast in the hook
                    }
                  }}
                  disabled={testConnection.isPending || isPending}
                  className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
                >
                  {testConnection.isPending ? "✨ Testing..." : "✨ Send Test Email"}
                </button>
              </div>
              <p className="text-xs text-neutral-600 dark:text-neutral-300">
                Send a test email to verify your connection is working
                correctly.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            {type === "smtp" && (
              <button
                type="submit"
                disabled={
                  isPending ||
                  !name.trim() ||
                  (!isEditing &&
                    (!smtpHost.trim() ||
                      !smtpPort.trim() ||
                      !smtpUsername.trim() ||
                      !smtpPassword.trim() ||
                      !smtpFromEmail.trim()))
                }
                className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending
                  ? isEditing
                    ? "Saving..."
                    : "Creating..."
                  : isEditing
                  ? "Save"
                  : "Create"}
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending}
              className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-surface-50 dark:text-neutral-50 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
