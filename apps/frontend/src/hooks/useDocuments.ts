import { useSuspenseQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listDocuments,
  listFolders,
  uploadDocument,
  uploadDocuments,
  getDocument,
  updateDocument,
  renameDocument,
  deleteDocument,
  type CreateDocumentInput,
  type UpdateDocumentInput,
} from "../utils/api";

import { useToast } from "./useToast";

export function useDocuments(workspaceId: string, folderPath?: string) {
  return useSuspenseQuery({
    queryKey: ["documents", workspaceId, folderPath],
    queryFn: async () => {
      const result = await listDocuments(workspaceId, folderPath);
      return result.documents;
    },
  });
}

export function useFolders(workspaceId: string) {
  return useQuery({
    queryKey: ["folders", workspaceId],
    queryFn: async () => {
      const result = await listFolders(workspaceId);
      return result.folders;
    },
    // Provide a default empty array so the component can render even if query fails
    initialData: [],
    placeholderData: [],
    // Retry on failure but don't block rendering
    retry: 2,
    // Don't throw errors - just return empty array
    throwOnError: false,
  });
}

export function useDocument(workspaceId: string, documentId: string) {
  return useSuspenseQuery({
    queryKey: ["document", workspaceId, documentId],
    queryFn: () => getDocument(workspaceId, documentId),
  });
}

export function useUploadDocument(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async (input: {
      file: File | CreateDocumentInput;
      folderPath?: string;
    }) => {
      return uploadDocument(workspaceId, input.file, input.folderPath);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["folders", workspaceId] });
      queryClient.setQueryData(
        ["document", workspaceId, data.id],
        { ...data, content: "" }
      );
      toast.success("Document uploaded successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to upload document");
    },
  });
}

export function useUploadDocuments(workspaceId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async (input: {
      files: File[];
      folderPath?: string;
    }) => {
      return uploadDocuments(workspaceId, input.files, input.folderPath);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["folders", workspaceId] });
      toast.success(`${data.length} document(s) uploaded successfully`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to upload documents");
    },
  });
}

export function useUpdateDocument(workspaceId: string, documentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: UpdateDocumentInput) =>
      updateDocument(workspaceId, documentId, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["folders", workspaceId] });
      queryClient.setQueryData(["document", workspaceId, documentId], data);
      toast.success("Document updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update document");
    },
  });
}

export function useRenameDocument(workspaceId: string, documentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (name: string) => renameDocument(workspaceId, documentId, name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      queryClient.setQueryData(["document", workspaceId, documentId], data);
      toast.success("Document renamed successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to rename document");
    },
  });
}

export function useDeleteDocument(workspaceId: string, documentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => deleteDocument(workspaceId, documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["folders", workspaceId] });
      queryClient.removeQueries({ queryKey: ["document", workspaceId, documentId] });
      toast.success("Document deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete document");
    },
  });
}

