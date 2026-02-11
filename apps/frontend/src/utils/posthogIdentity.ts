/**
 * True when we should call posthog.alias(newId) before identify, so PostHog merges
 * the anonymous profile into the identified user (avoids duplicate profiles with the same email).
 */
export function shouldAliasBeforeIdentify(
  currentDistinctId: string | null,
  newUserId: string
): boolean {
  const newId = `user/${newUserId}`;
  return currentDistinctId != null && currentDistinctId !== newId;
}
