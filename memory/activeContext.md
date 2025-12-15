# Active Context

## Current Status

**Status**: Initialization

## Recent Changes

- **Subscription and Credit Purchase Fixes** (Latest)

  - Fixed Lemon Squeezy portal URL to always redirect to `https://app.lemonsqueezy.com/my-orders` instead of using dynamic customer portal URLs
  - Fixed issue where free plans incorrectly showed as "cancelled" with renewal dates - added cleanup logic to remove Lemon Squeezy-related fields (status, renewsAt, endsAt) from free plans
  - Added credit purchase functionality to the UI - integrated `CreditPurchase` component into workspace detail page with proper currency support
  - Fixed redirect URL after credit purchase to return users to workspace page instead of Lemon Squeezy customer portal
  - Enhanced credit purchase checkout creation with extensive logging to track `custom_price` values through the entire flow
  - Added variant configuration checking to verify PWYW (Pay What You Want) status and log warnings
  - Updated product description in checkout to guide users on entering the correct amount for PWYW variants
  - Added verification logic to ensure `custom_price` is correctly set and returned by Lemon Squeezy API
  - All changes verified with type checking and linting

- **Test Refactoring: Use Actual Route Handlers**

  - Fixed issue where test files (`get-workspace-api-key.test.ts`, `delete-workspace-api-key.test.ts`, `put-workspace-api-key.test.ts`) were using inlined handler implementations instead of importing and testing the actual route handlers
  - Created `route-test-helpers.ts` utility that captures route handlers during Express app registration, allowing tests to use the real implementation
  - Refactored all three test files to import and register actual route handlers instead of duplicating logic
  - Tests now properly verify the actual route behavior, including correct migration logic (e.g., `createdAt` is NOT passed during migration, matching the real implementation)
  - This ensures tests will catch bugs in the real implementation and won't diverge from the code over time
  - Fixed linting errors by adding `eslint-disable-next-line import/order` comments where necessary for test helper imports

- **Credit Deduction Test Coverage**

  - Analyzed credit deduction flow across all endpoints (test agent, webhook, stream, agent delegation)
  - Identified gaps in test coverage for `adjustCreditReservation` calls
  - Added comprehensive integration tests to verify credit deduction is correctly applied for each generated message
  - Tests verify that `adjustCreditReservation` is called with correct parameters (reservationId, workspaceId, provider, modelName, tokenUsage, maxRetries, usesByok)
  - Added edge case tests for scenarios where credit deduction should not occur (undefined tokenUsage, zero tokens, BYOK requests, feature flag disabled)
  - Added error handling tests to ensure requests succeed even if credit adjustment fails
  - Tests added for webhook handler and stream handler endpoints
  - Refined test suite to focus on essential credit deduction verification scenarios

- **Token Usage Preservation for Assistant Messages**

  - Fixed issue where only the last assistant message had tokenUsage; now all assistant messages preserve their tokenUsage
  - Enhanced `updateConversation` in `conversationLogger.ts` to preserve tokenUsage from existing assistant messages during full history replacement
  - Added logic to recover/infer tokenUsage for assistant messages that don't have it by calculating from conversation-level tokenUsage (when possible)
  - Fixed missing `reasoningTokens` in database schema - added `reasoningTokens: z.number().optional()` to `agent-conversations` schema in `schema.ts`
  - ReasoningTokens are now properly preserved in conversation-level tokenUsage records
  - Added comprehensive test coverage for tokenUsage preservation and recovery scenarios
  - **Note**: For existing conversations where the first message was created without tokenUsage and conversation-level tokenUsage only reflects the last message, we cannot retroactively recover the first message's tokenUsage. Going forward, all new assistant messages will have tokenUsage attached.

- **API Gateway Auto-Deployment**

  - Created `scripts/deploy-api-gateway.sh` to automatically trigger API Gateway deployments after CloudFormation stack updates
  - Updated `.github/workflows/deploy-prod.yml` to run API Gateway deployment after production deploys
  - Updated `.github/workflows/deploy-pr.yml` to run API Gateway deployment after PR deploys
  - This ensures API Gateway changes (routes, methods, integrations) are immediately live after `arc deploy` completes
  - Script retrieves REST API ID and stage name from CloudFormation outputs and creates a new deployment
  - Handles edge cases like missing outputs, rate limiting, and determines stage name from stack name if needed

- Memory Bank strategy initialized
- Created memory folder structure with three core files

## Next Steps

1. Analyze codebase structure and patterns
2. Document architectural decisions
3. Identify any ongoing work or technical debt

## Notes

- Project is actively maintained
- Uses AWS serverless architecture (Lambda, API Gateway, DynamoDB)
- Monorepo structure with backend and frontend apps
- PR deployments create CloudFormation stacks for testing
