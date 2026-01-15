import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import {
  listEvalJudges,
  getEvalJudge,
  createEvalJudge,
  updateEvalJudge,
  deleteEvalJudge,
  getAgentEvalResults,
  type CreateEvalJudgeInput,
  type UpdateEvalJudgeInput,
  type GetAgentEvalResultsParams,
} from "../utils/api";

import { useToast } from "./useToast";

export function useEvalJudges(workspaceId: string, agentId: string) {
  return useQuery({
    queryKey: ["workspaces", workspaceId, "agents", agentId, "eval-judges"],
    queryFn: () => listEvalJudges(workspaceId, agentId),
    enabled: !!workspaceId && !!agentId,
  });
}

export function useEvalJudge(
  workspaceId: string,
  agentId: string,
  judgeId: string
) {
  return useQuery({
    queryKey: [
      "workspaces",
      workspaceId,
      "agents",
      agentId,
      "eval-judges",
      judgeId,
    ],
    queryFn: () => getEvalJudge(workspaceId, agentId, judgeId),
    enabled: !!workspaceId && !!agentId && !!judgeId,
  });
}

export function useCreateEvalJudge(workspaceId: string, agentId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: CreateEvalJudgeInput) =>
      createEvalJudge(workspaceId, agentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "eval-judges"],
      });
      toast.success("Evaluation judge created successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to create evaluation judge");
    },
  });
}

export function useUpdateEvalJudge(
  workspaceId: string,
  agentId: string,
  judgeId: string
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: (input: UpdateEvalJudgeInput) =>
      updateEvalJudge(workspaceId, agentId, judgeId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "eval-judges"],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "workspaces",
          workspaceId,
          "agents",
          agentId,
          "eval-judges",
          judgeId,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "workspaces",
          workspaceId,
          "agents",
          agentId,
          "eval-results",
        ],
      });
      toast.success("Evaluation judge updated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to update evaluation judge");
    },
  });
}

export function useDeleteEvalJudge(
  workspaceId: string,
  agentId: string,
  judgeId: string
) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () => deleteEvalJudge(workspaceId, agentId, judgeId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "agents", agentId, "eval-judges"],
      });
      queryClient.removeQueries({
        queryKey: [
          "workspaces",
          workspaceId,
          "agents",
          agentId,
          "eval-judges",
          judgeId,
        ],
      });
      queryClient.invalidateQueries({
        queryKey: [
          "workspaces",
          workspaceId,
          "agents",
          agentId,
          "eval-results",
        ],
      });
      toast.success("Evaluation judge deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete evaluation judge");
    },
  });
}

export function useAgentEvalResults(
  workspaceId: string,
  agentId: string,
  filters?: GetAgentEvalResultsParams
) {
  return useQuery({
    queryKey: [
      "workspaces",
      workspaceId,
      "agents",
      agentId,
      "eval-results",
      filters,
    ],
    queryFn: () => getAgentEvalResults(workspaceId, agentId, filters),
    enabled: !!workspaceId && !!agentId,
  });
}
