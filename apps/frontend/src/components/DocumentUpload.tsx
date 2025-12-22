import { useState, useRef } from "react";
import type { FC, DragEvent } from "react";

import {
  useUploadDocument,
  useUploadDocuments,
  useFolders,
} from "../hooks/useDocuments";
import type { CreateDocumentInput } from "../utils/api";

interface DocumentUploadProps {
  workspaceId: string;
  currentFolder?: string;
}

export const DocumentUpload: FC<DocumentUploadProps> = ({
  workspaceId,
  currentFolder,
}) => {
  const { data: folders = [] } = useFolders(workspaceId);
  const uploadDocument = useUploadDocument(workspaceId);
  const uploadDocuments = useUploadDocuments(workspaceId);

  const [isDragging, setIsDragging] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState(currentFolder || "");
  const [newFolderName, setNewFolderName] = useState("");
  const [textDocumentName, setTextDocumentName] = useState("");
  const [textDocumentContent, setTextDocumentContent] = useState("");
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files).filter((file) => {
      const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
      return [".md", ".txt", ".markdown"].includes(ext);
    });

    if (files.length === 0) {
      alert("Please drop markdown or text files only (.md, .txt, .markdown)");
      return;
    }

    await handleFileUpload(files);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter((file) => {
      const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
      return [".md", ".txt", ".markdown"].includes(ext);
    });

    if (validFiles.length === 0) {
      alert("Please select markdown or text files only (.md, .txt, .markdown)");
      return;
    }

    await handleFileUpload(validFiles);
  };

  const handleFileUpload = async (files: File[]) => {
    const folderPath = newFolderName.trim()
      ? newFolderName.trim()
      : selectedFolder;

    setUploadProgress(`Uploading ${files.length} file(s)...`);

    try {
      if (files.length === 1) {
        await uploadDocument.mutateAsync({
          file: files[0],
          folderPath: folderPath || undefined,
        });
      } else {
        await uploadDocuments.mutateAsync({
          files,
          folderPath: folderPath || undefined,
        });
      }
      setUploadProgress(null);
      setNewFolderName("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch {
      // Error is handled by toast in the hook
      setUploadProgress(null);
    }
  };

  const handleTextDocumentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textDocumentName.trim() || !textDocumentContent.trim()) return;

    const folderPath = newFolderName.trim()
      ? newFolderName.trim()
      : selectedFolder;

    setUploadProgress("Uploading text document...");

    try {
      const input: CreateDocumentInput = {
        name: textDocumentName.trim(),
        content: textDocumentContent.trim(),
      };
      await uploadDocument.mutateAsync({
        file: input,
        folderPath: folderPath || undefined,
      });
      setUploadProgress(null);
      setTextDocumentName("");
      setTextDocumentContent("");
      setNewFolderName("");
    } catch {
      // Error is handled by toast in the hook
      setUploadProgress(null);
    }
  };

  const folderOptions = folders
    .filter((f) => f !== "")
    .sort()
    .map((folder) => (
      <option key={folder} value={folder}>
        {folder}
      </option>
    ));

  return (
    <div className="mb-8 rounded-lg border border-neutral-200 bg-white p-6 shadow-soft dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="mb-5 text-3xl font-bold text-neutral-900 dark:text-neutral-50">
        Upload Documents
      </h2>
      <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
        Upload documents (markdown or text files) that your agents can reference
        when answering questions. Documents are organized in folders and can be
        searched by agents during conversations. Maximum file size is 10MB per
        file.
      </p>

      {/* Folder selection */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          Destination Folder
        </label>
        <div className="flex gap-2">
          <select
            value={selectedFolder}
            onChange={(e) => {
              setSelectedFolder(e.target.value);
              setNewFolderName("");
            }}
            className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          >
            <option value="">Root</option>
            {folderOptions}
          </select>
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => {
              setNewFolderName(e.target.value);
              setSelectedFolder("");
            }}
            placeholder="Or create new folder..."
            className="flex-1 rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
          />
        </div>
      </div>

      {/* Drag and drop area */}
      <div
        className={`mb-4 rounded-lg border-2 border-dashed border-neutral-300 p-8 text-center transition-colors ${
          isDragging ? "border-primary-400 bg-primary-50 dark:border-primary-500 dark:bg-primary-950" : "bg-neutral-50 dark:bg-neutral-800"
        }`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <p className="mb-2 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          Drag and drop files here
        </p>
        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">or</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".md,.txt,.markdown"
          onChange={handleFileSelect}
          className="hidden"
          id="file-upload"
        />
        <label
          htmlFor="file-upload"
          className="inline-block cursor-pointer rounded-xl bg-gradient-primary px-4 py-2.5 font-semibold text-white transition-colors hover:shadow-colored"
        >
          Select Files
        </label>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-300">
          Supported: .md, .txt, .markdown (max 10MB per file)
        </p>
      </div>

      {/* Text document creation */}
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
        <h3 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          Create Text Document
        </h3>
        <form onSubmit={handleTextDocumentSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Document Name
            </label>
            <input
              type="text"
              value={textDocumentName}
              onChange={(e) => setTextDocumentName(e.target.value)}
              placeholder="e.g., My Document"
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Content
            </label>
            <textarea
              value={textDocumentContent}
              onChange={(e) => setTextDocumentContent(e.target.value)}
              placeholder="Enter document content here..."
              className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 font-mono text-neutral-900 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              rows={8}
            />
          </div>
          <button
            type="submit"
            disabled={
              !textDocumentName.trim() ||
              !textDocumentContent.trim() ||
              uploadDocument.isPending
            }
            className="rounded-xl bg-primary-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploadDocument.isPending ? "Uploading..." : "Create Document"}
          </button>
        </form>
      </div>

      {/* Upload progress */}
      {uploadProgress && (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
          <p className="font-medium text-blue-900 dark:text-blue-100">{uploadProgress}</p>
        </div>
      )}
    </div>
  );
};
