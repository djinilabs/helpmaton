import { useState, useMemo } from "react";
import type { FC } from "react";

import {
  useDocuments,
  useDeleteDocument,
  useFolders,
} from "../hooks/useDocuments";

import { DocumentViewer } from "./DocumentViewer";

interface DocumentListProps {
  workspaceId: string;
  currentFolder?: string;
  onFolderChange?: (folder: string) => void;
  canEdit: boolean;
}

export const DocumentList: FC<DocumentListProps> = ({
  workspaceId,
  currentFolder,
  onFolderChange,
  canEdit,
}) => {
  const { data: documents } = useDocuments(workspaceId, currentFolder);
  const { data: folders } = useFolders(workspaceId);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null
  );

  // Get folders for navigation
  const folderList = useMemo(() => {
    return folders.filter((f) => f !== "").sort();
  }, [folders]);

  const handleDocumentClick = (documentId: string) => {
    setSelectedDocumentId(documentId);
  };

  const handleCloseViewer = () => {
    setSelectedDocumentId(null);
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const getFolderDisplayName = (folder: string): string => {
    return folder || "Root";
  };

  // Build breadcrumb path
  const breadcrumbs = useMemo(() => {
    if (!currentFolder) return ["Root"];
    return ["Root", ...currentFolder.split("/")];
  }, [currentFolder]);

  const handleBreadcrumbClick = (index: number) => {
    if (index === 0) {
      onFolderChange?.("");
    } else {
      const path = breadcrumbs.slice(1, index + 1).join("/");
      onFolderChange?.(path);
    }
  };

  return (
    <>
      <div className="border border-neutral-200 rounded-2xl p-6 mb-8 bg-white shadow-soft">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-3xl font-bold text-neutral-900">Documents</h2>
        </div>
        <p className="text-sm text-neutral-600 mb-6">
          Browse and manage documents uploaded to this workspace. Documents are
          organized in folders and can be accessed by agents during
          conversations. Click on a document to view its contents.
        </p>

        {/* Breadcrumb navigation */}
        {currentFolder !== undefined && (
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            {breadcrumbs.map((crumb, index) => (
              <div key={index} className="flex items-center gap-2">
                {index > 0 && <span className="text-neutral-400">/</span>}
                <button
                  onClick={() => handleBreadcrumbClick(index)}
                  className={`text-sm font-medium hover:text-primary-600 transition-colors ${
                    index === breadcrumbs.length - 1
                      ? "text-neutral-900"
                      : "text-neutral-600"
                  }`}
                >
                  {crumb}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Folder navigation */}
        {folderList.length > 0 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              {folderList
                .filter((folder) => {
                  // Show folders that are direct children of current folder
                  if (!currentFolder) {
                    return !folder.includes("/");
                  }
                  return (
                    folder.startsWith(currentFolder + "/") &&
                    folder.substring(currentFolder.length + 1).split("/")
                      .length === 1
                  );
                })
                .map((folder) => {
                  const folderName = folder.substring(
                    currentFolder ? currentFolder.length + 1 : 0
                  );
                  return (
                    <button
                      key={folder}
                      onClick={() => onFolderChange?.(folder)}
                      className="border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium rounded-lg hover:bg-neutral-50 transition-colors"
                    >
                      📁 {folderName}
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Documents list */}
        {documents.length === 0 ? (
          <p className="text-lg text-neutral-600">
            {currentFolder
              ? `No documents in "${getFolderDisplayName(
                  currentFolder
                )}" folder.`
              : "No documents yet. Upload your first document to get started."}
          </p>
        ) : (
          <div className="space-y-2">
            {documents
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((document) => (
                <div
                  key={document.id}
                  className="border-2 border-neutral-300 rounded-xl p-6 bg-white flex justify-between items-center hover:shadow-bold hover:border-primary-400 transition-all duration-200 transform hover:scale-[1.01] active:scale-[0.99]"
                >
                  <div className="flex-1">
                    <button
                      onClick={() => handleDocumentClick(document.id)}
                      className="text-xl font-bold text-neutral-900 hover:text-primary-600 transition-colors text-left"
                    >
                      {document.name}
                    </button>
                    <div className="text-sm text-neutral-500 mt-1">
                      {formatSize(document.size)} •{" "}
                      {new Date(document.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {canEdit && (
                    <DeleteButton
                      workspaceId={workspaceId}
                      documentId={document.id}
                      documentName={document.name}
                    />
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {selectedDocumentId && (
        <DocumentViewer
          isOpen={true}
          onClose={handleCloseViewer}
          workspaceId={workspaceId}
          documentId={selectedDocumentId}
        />
      )}
    </>
  );
};

interface DeleteButtonProps {
  workspaceId: string;
  documentId: string;
  documentName: string;
}

const DeleteButton: FC<DeleteButtonProps> = ({
  workspaceId,
  documentId,
  documentName,
}) => {
  const deleteDocument = useDeleteDocument(workspaceId, documentId);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (
      !confirm(
        `Are you sure you want to delete "${documentName}"? This action cannot be undone.`
      )
    ) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteDocument.mutateAsync();
    } catch {
      // Error is handled by toast in the hook
      setIsDeleting(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={isDeleting}
      className="bg-error-600 px-5 py-2.5 text-white text-sm font-bold rounded-xl hover:bg-error-700 hover:shadow-error disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
    >
      {isDeleting ? "Deleting..." : "Delete"}
    </button>
  );
};
