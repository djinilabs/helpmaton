import { useState, useEffect, useRef } from "react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";

import { useDialogTracking } from "../contexts/DialogContext";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useImportWorkspace } from "../hooks/useWorkspaces";
import type { WorkspaceExport } from "../utils/api";
import { trackEvent } from "../utils/tracking";

interface ImportWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ImportWorkspaceModal: FC<ImportWorkspaceModalProps> = ({
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const importWorkspace = useImportWorkspace();
  const { registerDialog, unregisterDialog } = useDialogTracking();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    setSelectedFile(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onClose();
  };

  useEscapeKey(isOpen, handleClose);

  useEffect(() => {
    if (isOpen) {
      registerDialog();
      return () => unregisterDialog();
    }
  }, [isOpen, registerDialog, unregisterDialog]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setFileError(null);
      return;
    }

    // Validate file type
    if (!file.name.toLowerCase().endsWith(".json")) {
      setFileError("Please select a JSON file");
      setSelectedFile(null);
      return;
    }

    setFileError(null);
    setSelectedFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setFileError("Please select a file");
      return;
    }

    try {
      // Read file content
      const fileContent = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result && typeof event.target.result === "string") {
            resolve(event.target.result);
          } else {
            reject(new Error("Failed to read file"));
          }
        };
        reader.onerror = () => {
          reject(new Error("Error reading file"));
        };
        reader.readAsText(selectedFile);
      });

      // Parse JSON
      let exportData: WorkspaceExport;
      try {
        exportData = JSON.parse(fileContent);
      } catch {
        setFileError("Invalid JSON file. Please check the file format.");
        return;
      }

      // Validate basic structure
      if (!exportData || typeof exportData !== "object") {
        setFileError("Invalid workspace export format");
        return;
      }

      if (!exportData.name || typeof exportData.name !== "string") {
        setFileError("Invalid workspace export: missing or invalid name");
        return;
      }

      // Import workspace
      const workspace = await importWorkspace.mutateAsync(exportData);
      trackEvent("workspace_imported", {
        workspace_id: workspace.id,
      });
      handleClose();
      navigate(`/workspaces/${workspace.id}`);
    } catch (error) {
      // Error is handled by toast in the hook, but we can also set file error for UI feedback
      if (error instanceof Error && !importWorkspace.isError) {
        setFileError(error.message);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-8 text-4xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">
          Import Workspace
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="workspace-file"
              className="mb-2.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Workspace Export File *
            </label>
            <input
              id="workspace-file"
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelect}
              className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-900 transition-all duration-200 file:mr-4 file:rounded-lg file:border-0 file:bg-primary-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-700 hover:file:bg-primary-100 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:file:bg-primary-900/20 dark:file:text-primary-300 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
            />
            {selectedFile && (
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                Selected: {selectedFile.name}
              </p>
            )}
            {fileError && (
              <p className="mt-2 text-sm font-semibold text-error-600 dark:text-error-400">
                {fileError}
              </p>
            )}
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
              Select a workspace export JSON file to create a new workspace from
              it.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={importWorkspace.isPending || !selectedFile}
              className="flex-1 transform rounded-xl bg-gradient-primary px-8 py-4 font-bold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-colored active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
            >
              {importWorkspace.isPending ? "Importing..." : "Import"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={importWorkspace.isPending}
              className="flex-1 transform rounded-xl border-2 border-neutral-300 bg-white px-8 py-4 font-bold text-neutral-900 transition-all duration-200 hover:scale-[1.02] hover:border-neutral-400 hover:bg-neutral-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
