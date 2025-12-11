import {
  useSuspenseQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import {
  listUserApiKeys,
  createUserApiKey,
  deleteUserApiKey,
  type CreateUserApiKeyInput,
} from "../utils/api";

import { useToast } from "./useToast";

export function useUserApiKeys() {
  return useSuspenseQuery({
    queryKey: ["user-api-keys"],
    queryFn: listUserApiKeys,
  });
}

export function useCreateUserApiKey() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateUserApiKeyInput) => createUserApiKey(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-api-keys"] });
      toast.success("API key created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create API key");
    },
  });
}

export function useDeleteUserApiKey() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (keyId: string) => deleteUserApiKey(keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-api-keys"] });
      toast.success("API key deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete API key");
    },
  });
}
