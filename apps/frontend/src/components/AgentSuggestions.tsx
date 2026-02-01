import { useCallback } from "react";
import type { FC } from "react";

import {
  useAgentSuggestions,
  useDismissAgentSuggestion,
} from "../hooks/useAgents";
import type { SuggestionItem } from "../utils/api";
import type { SuggestionActionPayload } from "../utils/suggestionActions";
import { getSuggestionAction } from "../utils/suggestionActions";

import { SuggestionsBox } from "./SuggestionsBox";

type AgentSuggestionsProps = {
  workspaceId: string;
  agentId: string;
  /** Called when user clicks action; client expands section/scrolls or opens edit modal. */
  onGoToAction?: (action: SuggestionActionPayload) => void;
};

/**
 * Fetches and displays agent suggestions in a separate request.
 * Renders nothing while loading, on error, or when there are no suggestions.
 */
export const AgentSuggestions: FC<AgentSuggestionsProps> = ({
  workspaceId,
  agentId,
  onGoToAction,
}) => {
  const { data, isPending, isError } = useAgentSuggestions(
    workspaceId,
    agentId,
  );
  const dismissAgentSuggestion = useDismissAgentSuggestion(
    workspaceId,
    agentId,
  );

  const getAction = useCallback(
    (item: SuggestionItem) =>
      item.actionType
        ? getSuggestionAction(item.actionType, workspaceId, agentId)
        : null,
    [workspaceId, agentId],
  );

  if (isPending || isError || !data?.suggestions?.items?.length) {
    return null;
  }

  return (
    <SuggestionsBox
      items={data.suggestions.items}
      isDismissing={dismissAgentSuggestion.isPending}
      onDismiss={(id) => dismissAgentSuggestion.mutate(id)}
      getAction={getAction}
      onGoToAction={onGoToAction}
    />
  );
};
