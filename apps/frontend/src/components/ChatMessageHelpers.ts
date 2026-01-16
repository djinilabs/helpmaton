/**
 * Helper functions for chat message rendering.
 * These are pure functions that don't depend on component state.
 */

export function getRoleLabel(role: string): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Agent";
    case "system":
      return "System";
    default:
      return role;
  }
}

export function getRoleStyling(role: string): string {
  switch (role) {
    case "user":
      return "bg-gradient-primary text-white ml-auto shadow-colored";
    case "system":
      return "bg-neutral-200 text-neutral-800 italic border-2 border-neutral-400 font-bold dark:bg-neutral-700 dark:text-neutral-200 dark:border-neutral-600";
    case "assistant":
    default:
      return "bg-neutral-100 text-neutral-900 border-2 border-neutral-300 dark:bg-neutral-800 dark:text-neutral-50 dark:border-neutral-700";
  }
}
