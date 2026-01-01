import express from "express";

import { expressErrorHandler } from "../utils/errorHandler";

// Import all route handlers (sorted alphabetically)
import { registerDeleteAgentKey } from "./routes/delete-agent-key";
import { registerDeleteAgentSpendingLimits } from "./routes/delete-agent-spending-limits";
import { registerDeleteEmailConnection } from "./routes/delete-email-connection";
import { registerDeleteMcpServer } from "./routes/delete-mcp-server";
import { registerDeleteStreamServers } from "./routes/delete-stream-servers";
import { registerDeleteWorkspace } from "./routes/delete-workspace";
import { registerDeleteWorkspaceAgent } from "./routes/delete-workspace-agent";
import { registerDeleteWorkspaceApiKey } from "./routes/delete-workspace-api-key";
import { registerDeleteWorkspaceChannel } from "./routes/delete-workspace-channel";
import { registerDeleteWorkspaceDocument } from "./routes/delete-workspace-document";
import { registerDeleteWorkspaceInvite } from "./routes/delete-workspace-invite";
import { registerDeleteWorkspaceMember } from "./routes/delete-workspace-member";
import { registerDeleteWorkspaceSpendingLimits } from "./routes/delete-workspace-spending-limits";
import { registerGetAgentConversation } from "./routes/get-agent-conversation";
import { registerGetAgentConversations } from "./routes/get-agent-conversations";
import { registerGetAgentKeys } from "./routes/get-agent-keys";
import { registerGetAgentMemory } from "./routes/get-agent-memory";
import { registerGetAgentTransactions } from "./routes/get-agent-transactions";
import { registerGetAgentUsage } from "./routes/get-agent-usage";
import { registerGetAgentUsageDaily } from "./routes/get-agent-usage-daily";
import { registerGetEmailConnection } from "./routes/get-email-connection";
import { registerGetEmailOauthAuthorize } from "./routes/get-email-oauth-authorize";
import { registerGetEmailOauthCallback } from "./routes/get-email-oauth-callback";
import { registerGetMcpServer } from "./routes/get-mcp-server";
import { registerGetMcpServers } from "./routes/get-mcp-servers";
import { registerGetStreamServers } from "./routes/get-stream-servers";
import { registerGetTrialStatus } from "./routes/get-trial-status";
import { registerGetWorkspaceAgent } from "./routes/get-workspace-agent";
import { registerGetWorkspaceAgents } from "./routes/get-workspace-agents";
import { registerGetWorkspaceApiKey } from "./routes/get-workspace-api-key";
import { registerGetWorkspaceApiKeys } from "./routes/get-workspace-api-keys";
import { registerGetWorkspaceById } from "./routes/get-workspace-by-id";
import { registerGetWorkspaceChannel } from "./routes/get-workspace-channel";
import { registerGetWorkspaceChannels } from "./routes/get-workspace-channels";
import { registerGetWorkspaceDocument } from "./routes/get-workspace-document";
import { registerGetWorkspaceDocumentFolders } from "./routes/get-workspace-document-folders";
import { registerGetWorkspaceDocuments } from "./routes/get-workspace-documents";
import { registerGetWorkspaceDocumentsSearch } from "./routes/get-workspace-documents-search";
import { registerGetWorkspaceEmailOauthCallback } from "./routes/get-workspace-email-oauth-callback";
import { registerGetWorkspaceInvite } from "./routes/get-workspace-invite";
import { registerGetWorkspaceInvites } from "./routes/get-workspace-invites";
import { registerGetWorkspaceMembers } from "./routes/get-workspace-members";
import { registerGetWorkspaceTransactions } from "./routes/get-workspace-transactions";
import { registerGetWorkspaceUsage } from "./routes/get-workspace-usage";
import { registerGetWorkspaceUsageDaily } from "./routes/get-workspace-usage-daily";
import { registerGetWorkspaceUserLimit } from "./routes/get-workspace-user-limit";
import { registerGetWorkspaces } from "./routes/get-workspaces";
import { registerPatchRenameDocument } from "./routes/patch-rename-document";
import { registerPostAcceptWorkspaceInvite } from "./routes/post-accept-workspace-invite";
import { registerPostAgentKeys } from "./routes/post-agent-keys";
import { registerPostAgentSpendingLimits } from "./routes/post-agent-spending-limits";
import { registerPostEmailConnection } from "./routes/post-email-connection";
import { registerPostGeneratePrompt } from "./routes/post-generate-prompt";
import { registerPostMcpServer } from "./routes/post-mcp-server";
import { registerPostStreamServers } from "./routes/post-stream-servers";
import { registerPostTestAgent } from "./routes/post-test-agent";
import { registerPostTestChannel } from "./routes/post-test-channel";
import { registerPostTestEmailConnection } from "./routes/post-test-email-connection";
import { registerPostTrialCreditRequest } from "./routes/post-trial-credit-request";
import { registerPostWorkspaceAgents } from "./routes/post-workspace-agents";
import { registerPostWorkspaceChannels } from "./routes/post-workspace-channels";
import { registerPostWorkspaceCreditsPurchase } from "./routes/post-workspace-credits-purchase";
import { registerPostWorkspaceDocuments } from "./routes/post-workspace-documents";
import { registerPostWorkspaceInvite } from "./routes/post-workspace-invite";
import { registerPostWorkspaceMembers } from "./routes/post-workspace-members";
import { registerPostWorkspaceSpendingLimits } from "./routes/post-workspace-spending-limits";
import { registerPostWorkspaces } from "./routes/post-workspaces";
import { registerPutAgentSpendingLimits } from "./routes/put-agent-spending-limits";
import { registerPutEmailConnection } from "./routes/put-email-connection";
import { registerPutMcpServer } from "./routes/put-mcp-server";
import { registerPutStreamServers } from "./routes/put-stream-servers";
import { registerPutWorkspace } from "./routes/put-workspace";
import { registerPutWorkspaceAgent } from "./routes/put-workspace-agent";
import { registerPutWorkspaceApiKey } from "./routes/put-workspace-api-key";
import { registerPutWorkspaceChannel } from "./routes/put-workspace-channel";
import { registerPutWorkspaceDocument } from "./routes/put-workspace-document";
import { registerPutWorkspaceMember } from "./routes/put-workspace-member";
import { registerPutWorkspaceSpendingLimits } from "./routes/put-workspace-spending-limits";

export const createApp: () => express.Application = () => {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());

  // Add request logging middleware
  app.use((req, res, next) => {
    console.log(`[${req.method}] ${req.path}`);
    next();
  });

  // Add middleware to ensure requestId is available in headers for context lookup
  // serverlessExpress attaches the event to req.apiGateway.event
  app.use((req, res, next) => {
    // Try to get requestId from various sources (priority order)
    const requestId =
      // First check headers (might already be set)
      req.headers["x-amzn-requestid"] ||
      req.headers["X-Amzn-Requestid"] ||
      req.headers["x-request-id"] ||
      req.headers["X-Request-Id"] ||
      // Then check req.apiGateway.event (serverlessExpress attaches it)
      req.apiGateway?.event?.requestContext?.requestId ||
      // Fallback to Lambda context if available
      req.context?.awsRequestId;

    // If we found a requestId and it's not already in headers, add it
    if (requestId && typeof requestId === "string") {
      if (
        !req.headers["x-amzn-requestid"] &&
        !req.headers["X-Amzn-Requestid"]
      ) {
        req.headers["x-amzn-requestid"] = requestId;
      }
      if (!req.headers["x-request-id"] && !req.headers["X-Request-Id"]) {
        req.headers["x-request-id"] = requestId;
      }
    }
    next();
  });

  // CORS support for Function URL access
  // Always set CORS headers using FRONTEND_URL as the allowed origin
  // This is required for Function URLs to work properly
  const frontendUrl = process.env.FRONTEND_URL;

  // Handle OPTIONS preflight requests for all routes
  // Express doesn't support "*" as a route pattern, so we use a middleware that runs before routes
  app.use((req, res, next) => {
    // Handle OPTIONS preflight requests
    if (req.method === "OPTIONS") {
      // Always set Access-Control-Allow-Origin to FRONTEND_URL
      if (frontendUrl) {
        res.setHeader("Access-Control-Allow-Origin", frontendUrl);
      }

      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, PATCH, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id"
      );
      res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours

      res.status(204).end();
      return;
    }

    // Add CORS headers to all non-OPTIONS responses
    // Note: We don't set Content-Type here to allow route handlers to set it
    // (especially important for streaming responses which need text/event-stream)

    // Always set Access-Control-Allow-Origin to FRONTEND_URL
    if (frontendUrl) {
      res.setHeader("Access-Control-Allow-Origin", frontendUrl);
    }

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, PATCH, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With, Origin, Accept, X-Conversation-Id"
    );

    // Don't set Content-Type here - let route handlers set it
    // This is especially important for streaming responses (text/event-stream)

    next();
  });

  // Register all routes
  registerGetWorkspaces(app);
  registerPostWorkspaces(app);
  registerGetWorkspaceById(app);
  registerPutWorkspace(app);
  registerDeleteWorkspace(app);
  registerPostTrialCreditRequest(app);
  registerGetTrialStatus(app);
  registerPostWorkspaceSpendingLimits(app);
  registerPutWorkspaceSpendingLimits(app);
  registerDeleteWorkspaceSpendingLimits(app);
  registerGetWorkspaceMembers(app);
  registerPostWorkspaceMembers(app);
  registerPutWorkspaceMember(app);
  registerDeleteWorkspaceMember(app);
  registerPostWorkspaceInvite(app);
  registerGetWorkspaceInvite(app);
  registerGetWorkspaceInvites(app);
  registerDeleteWorkspaceInvite(app);
  registerGetWorkspaceUserLimit(app);
  registerPostAcceptWorkspaceInvite(app);
  registerGetWorkspaceAgents(app);
  registerPostWorkspaceAgents(app);
  registerPostGeneratePrompt(app);
  registerGetWorkspaceAgent(app);
  registerPutWorkspaceAgent(app);
  registerDeleteWorkspaceAgent(app);
  registerPostAgentSpendingLimits(app);
  registerPutAgentSpendingLimits(app);
  registerDeleteAgentSpendingLimits(app);
  registerPostAgentKeys(app);
  registerGetAgentKeys(app);
  registerDeleteAgentKey(app);
  registerGetAgentMemory(app);
  registerPutWorkspaceApiKey(app);
  registerGetWorkspaceApiKey(app);
  registerGetWorkspaceApiKeys(app);
  registerDeleteWorkspaceApiKey(app);
  registerGetAgentConversations(app);
  registerGetAgentConversation(app);
  registerGetAgentTransactions(app);
  registerGetWorkspaceTransactions(app);
  registerGetWorkspaceDocuments(app);
  registerGetWorkspaceDocumentFolders(app);
  registerGetWorkspaceDocumentsSearch(app);
  registerPostWorkspaceDocuments(app);
  registerGetWorkspaceDocument(app);
  registerPutWorkspaceDocument(app);
  registerPatchRenameDocument(app);
  registerDeleteWorkspaceDocument(app);
  registerGetWorkspaceChannels(app);
  registerPostWorkspaceChannels(app);
  registerGetWorkspaceChannel(app);
  registerPutWorkspaceChannel(app);
  registerDeleteWorkspaceChannel(app);
  registerPostTestChannel(app);
  registerPostWorkspaceCreditsPurchase(app);
  registerGetEmailConnection(app);
  registerPostEmailConnection(app);
  registerPutEmailConnection(app);
  registerDeleteEmailConnection(app);
  registerPostTestEmailConnection(app);
  registerGetEmailOauthAuthorize(app);
  registerGetEmailOauthCallback(app);
  registerGetWorkspaceEmailOauthCallback(app);
  registerGetWorkspaceUsage(app);
  registerGetWorkspaceUsageDaily(app);
  registerGetAgentUsageDaily(app);
  registerGetAgentUsage(app);
  registerGetMcpServers(app);
  registerGetMcpServer(app);
  registerPostMcpServer(app);
  registerPutMcpServer(app);
  registerDeleteMcpServer(app);
  registerPostTestAgent(app);
  registerPostStreamServers(app);
  registerGetStreamServers(app);
  registerPutStreamServers(app);
  registerDeleteStreamServers(app);

  // Error handler must be last
  app.use(expressErrorHandler);

  return app;
};
