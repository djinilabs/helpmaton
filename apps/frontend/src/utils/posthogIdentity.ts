/**
 * True when we should call posthog.alias(newId) before identify, so PostHog merges
 * the anonymous profile into the identified user (avoids duplicate profiles with the same email).
 * Only alias when the current ID is a non-empty anonymous id (does not start with "user/"), to
 * avoid aliasing between two identified user IDs (account-merging risk) or aliasing empty/invalid ids.
 */
export function shouldAliasBeforeIdentify(
  currentDistinctId: string | null,
  newUserId: string
): boolean {
  const newId = `user/${newUserId}`;
  return (
    currentDistinctId != null &&
    currentDistinctId !== "" &&
    currentDistinctId !== newId &&
    !currentDistinctId.startsWith("user/")
  );
}
