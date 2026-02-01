import { useCallback } from "react";
import type { FC } from "react";

import {
  useWorkspaceSuggestions,
  useDismissWorkspaceSuggestion,
} from "../hooks/useWorkspaces";
import type { SuggestionItem } from "../utils/api";
import type { SuggestionActionPayload } from "../utils/suggestionActions";
import { getSuggestionAction } from "../utils/suggestionActions";

import { SuggestionsBox } from "./SuggestionsBox";

type WorkspaceSuggestionsProps = {
  workspaceId: string;
  /** Called when user clicks action; client expands section and scrolls. */
  onGoToAction?: (action: SuggestionActionPayload) => void;
};

/**
 * Fetches and displays workspace suggestions in a separate request.
 * Renders nothing while loading, on error, or when there are no suggestions.
 */
export const WorkspaceSuggestions: FC<WorkspaceSuggestionsProps> = ({
  workspaceId,
  onGoToAction,
}) => {
  const { data, isPending, isError } = useWorkspaceSuggestions(workspaceId);
  const dismissWorkspaceSuggestion = useDismissWorkspaceSuggestion(workspaceId);

  const getAction = useCallback(
    (item: SuggestionItem) =>
      item.actionType
        ? getSuggestionAction(item.actionType, workspaceId, undefined)
        : null,
    [workspaceId],
  );

  if (isPending || isError || !data?.suggestions?.items?.length) {
    return null;
  }

  return (
    <SuggestionsBox
      title="Workspace suggestions"
      items={data.suggestions.items}
      isDismissing={dismissWorkspaceSuggestion.isPending}
      onDismiss={(id) => dismissWorkspaceSuggestion.mutate(id)}
      getAction={getAction}
      onGoToAction={onGoToAction}
    />
  );
};
