import type { EvalResult } from "./api";

export const canOpenEvalConversation = (
  result: EvalResult | null | undefined
): boolean => {
  if (!result) {
    return false;
  }
  if (typeof result.conversationId !== "string") {
    return false;
  }
  return result.conversationId.trim().length > 0;
};
