import { useState, useMemo, useEffect } from "react";
import type { FC } from "react";

import {
  useDocuments,
  useDeleteDocument,
  useFolders,
  useSearchDocuments,
} from "../hooks/useDocuments";
import { getSizeColor, getAgeColor, getPercentageColor } from "../utils/colorUtils";

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
  const { data: folders = [] } = useFolders(workspaceId);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchQuery, setActiveSearchQuery] = useState("");
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  
  // Update current time every minute for age calculations
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const { data: searchResults = [], isLoading: isSearching } =
    useSearchDocuments(workspaceId, activeSearchQuery);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setActiveSearchQuery(searchQuery.trim());
    }
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setActiveSearchQuery("");
  };

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
      <div className="mb-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-3xl font-bold text-neutral-900 dark:text-neutral-50">
            Documents
          </h2>
        </div>
        <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-300">
          Browse and manage documents uploaded to this workspace. Documents are
          organized in folders and can be accessed by agents during
          conversations. Click on a document to view its contents.
        </p>

        {/* Search input */}
        <div className="mb-6">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <svg
                  className="size-5 text-neutral-400 dark:text-neutral-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchQuery.trim()) {
                    handleSearch();
                  }
                }}
                placeholder="Search documents..."
                className="w-full rounded-xl border border-neutral-300 bg-white py-3 pl-12 pr-4 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:placeholder:text-neutral-400 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!searchQuery.trim()}
              className="rounded-xl bg-gradient-primary px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:shadow-colored disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
            >
              Search
            </button>
            {activeSearchQuery && (
              <button
                onClick={handleClearSearch}
                className="rounded-xl border border-neutral-300 bg-white px-6 py-3 text-sm font-semibold text-neutral-700 transition-all duration-200 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Breadcrumb navigation */}
        {currentFolder !== undefined && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {breadcrumbs.map((crumb, index) => (
              <div key={index} className="flex items-center gap-2">
                {index > 0 && <span className="text-neutral-400">/</span>}
                <button
                  onClick={() => handleBreadcrumbClick(index)}
                  className={`text-sm font-medium transition-colors hover:text-primary-600 ${
                    index === breadcrumbs.length - 1
                      ? "text-neutral-900 dark:text-neutral-50"
                      : "text-neutral-600 dark:text-neutral-300"
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
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800"
                    >
                      📁 {folderName}
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Search results or documents list */}
        {activeSearchQuery ? (
          isSearching ? (
            <p className="text-lg text-neutral-600 dark:text-neutral-300">
              Searching...
            </p>
          ) : searchResults.length === 0 ? (
            <p className="text-lg text-neutral-600 dark:text-neutral-300">
              No results found for &ldquo;{activeSearchQuery}&rdquo;.
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Found {searchResults.length} result
                {searchResults.length !== 1 ? "s" : ""} for &ldquo;
                {activeSearchQuery}&rdquo;
              </p>
              {searchResults.map((result) => {
                const truncatedSnippet =
                  result.snippet.length > 200
                    ? `${result.snippet.substring(0, 200)}...`
                    : result.snippet;
                const similarityPercent = Math.round(result.similarity * 100);

                return (
                  <div
                    key={`${result.documentId}-${result.snippet.substring(
                      0,
                      50
                    )}`}
                    className="flex flex-col gap-3 rounded-xl border-2 border-primary-200 bg-primary-50/30 p-6 transition-all duration-200 hover:border-primary-400 hover:shadow-bold dark:border-primary-800 dark:bg-primary-950/30 dark:hover:border-primary-600"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <button
                          onClick={() => handleDocumentClick(result.documentId)}
                          className="text-left text-xl font-bold text-neutral-900 transition-colors hover:text-primary-600 dark:text-neutral-50 dark:hover:text-primary-400"
                        >
                          {result.documentName}
                        </button>
                        {result.folderPath && (
                          <div className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                            📁 {result.folderPath || "Root"}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-lg border px-3 py-1 text-sm font-semibold ${getPercentageColor(
                            similarityPercent
                          )}`}
                        >
                          {similarityPercent}% match
                        </span>
                      </div>
                    </div>
                    <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      {truncatedSnippet}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : documents.length === 0 ? (
          <p className="text-lg text-neutral-600 dark:text-neutral-300">
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
                  className="flex transform items-center justify-between rounded-xl border-2 border-neutral-300 bg-white p-6 transition-all duration-200 hover:scale-[1.01] hover:border-primary-400 hover:shadow-bold active:scale-[0.99] dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-primary-500"
                >
                  <div className="flex-1">
                    <button
                      onClick={() => handleDocumentClick(document.id)}
                      className="text-left text-xl font-bold text-neutral-900 transition-colors hover:text-primary-600 dark:text-neutral-50 dark:hover:text-primary-400"
                    >
                      {document.name}
                    </button>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getSizeColor(
                          document.size
                        )}`}
                      >
                        {formatSize(document.size)}
                      </span>
                      <span
                        className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${getAgeColor(
                          Math.floor(
                            (currentTime - new Date(document.createdAt).getTime()) /
                              (1000 * 60 * 60 * 24)
                          )
                        )}`}
                      >
                        {new Date(document.createdAt).toLocaleDateString()}
                      </span>
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
      className="transform rounded-xl bg-error-600 px-5 py-2.5 text-sm font-bold text-white transition-all duration-200 hover:scale-[1.02] hover:bg-error-700 hover:shadow-error active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isDeleting ? "Deleting..." : "Delete"}
    </button>
  );
};
