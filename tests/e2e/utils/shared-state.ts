import { TestUser } from "./user-management";

/**
 * Shared state interface for chained E2E tests
 * Stores resource IDs and data created during test execution
 */
export interface TestState {
  user?: TestUser;
  workspace?: {
    id: string;
    name: string;
  };
  agent?: {
    id: string;
    workspaceId: string;
    name: string;
  };
  documents?: Array<{
    id: string;
    name: string;
    path?: string;
  }>;
  conversations?: Array<{
    id: string;
    agentId: string;
  }>;
  conversationId?: string;
}

/**
 * Global test state object
 * Used by chained tests to share state across test cases
 */
export const testState: TestState = {};

/**
 * Reset test state (useful for cleanup between test runs)
 */
export function resetTestState(): void {
  (Object.keys(testState) as Array<keyof TestState>).forEach((key) => {
    testState[key] = undefined;
  });
}
