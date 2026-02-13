/**
 * Determines whether to show the "Try with free credits" hint card on the workspace detail page.
 * Only shown when balance is zero, user can edit, user is on free plan, and has exactly one workspace.
 * Caller should also hide the card when the user has already requested trial credits (e.g. trialStatus.hasRequestedCredits).
 *
 * @param creditBalance - Workspace credit balance (e.g. 0 to show)
 * @param canEdit - Whether the user has WRITE permission or higher
 * @param isFreePlan - Whether the subscription plan is "free"
 * @param workspaceCount - Number of workspaces the user has access to (must be 1)
 * @returns true if the hint card should be shown based on these criteria
 */
export function shouldShowTrialCreditHint(
  creditBalance: number,
  canEdit: boolean,
  isFreePlan: boolean,
  workspaceCount: number
): boolean {
  return (
    creditBalance === 0 && canEdit && isFreePlan && workspaceCount === 1
  );
}
