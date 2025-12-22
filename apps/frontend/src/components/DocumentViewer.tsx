import { useState } from "react";
import type { FC } from "react";

import {
  useDocument,
  useUpdateDocument,
  useDeleteDocument,
  useFolders,
} from "../hooks/useDocuments";
import { useEscapeKey } from "../hooks/useEscapeKey";

import { QueryPanel } from "./QueryPanel";

interface DocumentViewerProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  documentId: string;
}

const DocumentViewerContent: FC<{
  workspaceId: string;
  documentId: string;
  onClose: () => void;
}> = ({ workspaceId, documentId, onClose }) => {
  const { data: document } = useDocument(workspaceId, documentId);
  const { data: folders = [] } = useFolders(workspaceId);
  const updateDocument = useUpdateDocument(workspaceId, documentId);
  const deleteDocument = useDeleteDocument(workspaceId, documentId);

  // Initialize state from document (always available due to useSuspenseQuery)
  // Component remounts when documentId changes (via key prop), so state is always fresh
  const [name, setName] = useState(() => document.name);
  const [content, setContent] = useState(() => document.content || "");
  const [folderPath, setFolderPath] = useState(() => document.folderPath || "");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSave = async () => {
    try {
      await updateDocument.mutateAsync({
        name,
        content,
        folderPath: folderPath !== document.folderPath ? folderPath : undefined,
      });
      onClose();
    } catch {
      // Error is handled by toast in the hook
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this document? This action cannot be undone."
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteDocument.mutateAsync();
      onClose();
    } catch {
      // Error is handled by toast in the hook
      setIsDeleting(false);
    }
  };

  const handleCancel = () => {
    setName(document.name);
    setContent(document.content);
    setFolderPath(document.folderPath);
    onClose();
  };

  if (!document) return null;

  const hasChanges =
    name !== document.name ||
    content !== document.content ||
    folderPath !== document.folderPath;

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto">
        <div>
          <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Folder
          </label>
          <select
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          >
            <option value="">Root</option>
            {folders
              .filter((f) => f !== "")
              .sort()
              .map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
          </select>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Content
            </label>
            <span className="text-xs text-neutral-500 dark:text-neutral-300">
              {new Date(document.createdAt).toLocaleString()} •{" "}
              {(document.size / 1024).toFixed(2)} KB
            </span>
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
            rows={20}
          />
        </div>
      </div>

      <div className="mt-4 flex gap-3 border-t border-neutral-200 pt-4 dark:border-neutral-700">
        <button
          onClick={handleSave}
          disabled={updateDocument.isPending || !name.trim() || !hasChanges}
          className="flex-1 rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50"
        >
          {updateDocument.isPending ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleCancel}
          disabled={updateDocument.isPending}
          className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={isDeleting || updateDocument.isPending}
          className="rounded-xl bg-error-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-error-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </>
  );
};

export const DocumentViewer: FC<DocumentViewerProps> = ({
  isOpen,
  onClose,
  workspaceId,
  documentId,
}) => {
  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border-2 border-neutral-300 bg-white p-8 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">Document</h2>
          <button
            onClick={onClose}
            className="rounded-xl border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-700 transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <QueryPanel
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <div className="text-lg font-medium text-neutral-600 dark:text-neutral-300">
                Loading document...
              </div>
            </div>
          }
        >
          <DocumentViewerContent
            key={documentId}
            workspaceId={workspaceId}
            documentId={documentId}
            onClose={onClose}
          />
        </QueryPanel>
      </div>
    </div>
  );
};
