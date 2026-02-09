/**
 * Workspace agent: virtual agent per workspace with tools to modify workspace and delegate to meta-agent.
 * Used when stream path is /api/streams/{workspaceId}/_workspace/test (or /workspace/test).
 */

import { randomUUID } from "crypto";

import { tool } from "ai";
import { z } from "zod";

import { database } from "../../tables";
import {
  ensureExactAuthorization,
  getUserAuthorizationLevelForResource,
  isUserAuthorized,
} from "../../tables/permissions";
import { PERMISSION_LEVELS } from "../../tables/schema";
import { removeAgentResources } from "../../utils/agentCleanup";
import { queryUsageStats } from "../../utils/aggregation";
import { indexDocument } from "../../utils/documentIndexing";
import {
  deleteDocument,
  getDocument,
  normalizeFolderPath,
  uploadDocument,
} from "../../utils/s3";
import {
  addSpendingLimit,
  updateSpendingLimit,
} from "../../utils/spendingLimitsManagement";
import {
  checkSubscriptionLimits,
  ensureWorkspaceSubscription,
 getUserEmailById } from "../../utils/subscriptionUtils";
import type { AugmentedContext } from "../../utils/workspaceCreditContext";
import {
  createWorkspaceInvite,
  sendInviteEmail,
} from "../../utils/workspaceInvites";


import { getWorkspaceApiKey } from "./agent-keys";
import { createAgentModel } from "./agent-model";
import {
  getInternalDocsPromptSection,
  READ_INTERNAL_DOC_TOOL_DESCRIPTION,
} from "./internalDocsPrompt";
import {
  executeReadInternalDoc,
  type ReadInternalDocState,
} from "./internalDocTool";
import type { LlmObserver } from "./llmObserver";
import { wrapToolsWithObserver } from "./llmObserver";
import { HELPMATON_PRODUCT_DESCRIPTION } from "./metaAgentProductContext";
import { getDefaultModel } from "./modelFactory";
import { userRef } from "./session";
import { WORKSPACE_AGENT_ID } from "./streamEndpointDetection";

/**
 * Minimal agent-like descriptor for stream context (no DB record).
 * pk/sk intentionally use workspace keys (workspaces/{id}, "workspace") so the
 * virtual agent is identified with the workspace, not an agent row.
 */
export type WorkspaceAgentDescriptor = {
  pk: string;
  sk?: string;
  workspaceId: string;
  name: string;
  systemPrompt: string;
  modelName?: string;
  enableKnowledgeInjection?: boolean;
  enableKnowledgeReranking?: boolean;
  enableKnowledgeInjectionFromDocuments?: boolean;
  enableKnowledgeInjectionFromMemories?: boolean;
  [key: string]: unknown;
};

const WORKSPACE_AGENT_SYSTEM_PROMPT = `You are the Helpmaton workspace assistant. You help the user manage their workspace and agents.

## Product
${HELPMATON_PRODUCT_DESCRIPTION} Credits are the workspace's usage balance; spending limits are optional daily, weekly, or monthly caps (workspace or per-agent).

## Tools you have
- **Workspace**: get_workspace, update_workspace
- **Members**: list_workspace_members, invite_member, update_member_role, remove_member (permission levels: 1=READ, 2=WRITE, 3=OWNER; invite and remove require owner)
- **Documents**: list_documents, get_document, create_document, update_document, delete_document
- **Agents**: list_agents, get_agent, create_agent, delete_agent, configure_agent
- **Integrations**: list_integrations (MCP, Discord, Slack, etc.)
- **Usage and billing**: get_workspace_usage, get_spending_limits, update_spending_limits

## Reserved agent IDs
For get_agent, delete_agent, and configure_agent you must use an agent ID from list_agents. The IDs _workspace and workspace are reserved (they refer to this workspace assistant) and must not be used as target agent IDs.

## Rules
- Use the provided tools to perform actions. Do not make up or assume data.
- For agent configuration changes, always use configure_agent(agentId, message) with a clear description of what to change. Pass an agent ID from list_agents, not _workspace or workspace.
- Confirm destructive actions (e.g. delete agent) with the user when appropriate.
${getInternalDocsPromptSection()}
`;

export function createWorkspaceAgentDescriptor(
  workspaceId: string
): WorkspaceAgentDescriptor {
  return {
    pk: `workspaces/${workspaceId}`,
    sk: "workspace",
    workspaceId,
    name: "Helpmaton workspace agent",
    systemPrompt: WORKSPACE_AGENT_SYSTEM_PROMPT,
    modelName: getDefaultModel(),
    enableKnowledgeInjection: false,
    enableKnowledgeReranking: false,
    enableKnowledgeInjectionFromDocuments: false,
    enableKnowledgeInjectionFromMemories: false,
  };
}

export type WorkspaceAgentSetupOptions = {
  modelReferer?: string;
  userId?: string;
  context?: AugmentedContext;
  conversationId?: string;
  llmObserver?: LlmObserver;
};

export type WorkspaceAgentSetup = {
  agent: WorkspaceAgentDescriptor;
  model: Awaited<ReturnType<typeof createAgentModel>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool types are complex
  tools: Record<string, any>;
  usesByok: boolean;
};

async function requireWorkspaceRead(
  workspaceId: string,
  userId: string | undefined
): Promise<void> {
  if (!userId) {
    throw new Error("Authentication required");
  }
  const userRef = `users/${userId}`;
  const resource = `workspaces/${workspaceId}`;
  const [authorized] = await isUserAuthorized(
    userRef,
    resource,
    PERMISSION_LEVELS.READ
  );
  if (!authorized) {
    throw new Error("Insufficient permissions to access this workspace");
  }
}

async function requireWorkspaceWrite(
  workspaceId: string,
  userId: string | undefined
): Promise<void> {
  if (!userId) {
    throw new Error("Authentication required");
  }
  const userRef = `users/${userId}`;
  const resource = `workspaces/${workspaceId}`;
  const [authorized] = await isUserAuthorized(
    userRef,
    resource,
    PERMISSION_LEVELS.WRITE
  );
  if (!authorized) {
    throw new Error("Insufficient permissions to modify this workspace");
  }
}

async function requireWorkspaceOwner(
  workspaceId: string,
  userId: string | undefined
): Promise<string> {
  if (!userId) {
    throw new Error("Authentication required");
  }
  const userRef = `users/${userId}`;
  const resource = `workspaces/${workspaceId}`;
  const [authorized] = await isUserAuthorized(
    userRef,
    resource,
    PERMISSION_LEVELS.OWNER
  );
  if (!authorized) {
    throw new Error("Insufficient permissions: owner access required");
  }
  return userRef;
}

/**
 * Creates the workspace agent tool set (get_workspace, list_agents, configure_agent, etc.)
 */
const RESERVED_AGENT_IDS = ["_workspace", "workspace"] as const;

function createWorkspaceAgentTools(
  workspaceId: string,
  userId: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool types
): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI SDK tool types
  const tools: Record<string, any> = {};
  const readInternalDocState: ReadInternalDocState = { callCount: 0 };

  tools.read_internal_doc = tool({
    description: READ_INTERNAL_DOC_TOOL_DESCRIPTION,
    parameters: z.object({ docId: z.string().min(1) }).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { docId } = z.object({ docId: z.string().min(1) }).parse(args);
      return executeReadInternalDoc(readInternalDocState, docId);
    },
  });

  tools.get_workspace = tool({
    description:
      "Get the current workspace details: name, description, credit balance, and subscription info.",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      await requireWorkspaceRead(workspaceId, userId);
      const db = await database();
      const pk = `workspaces/${workspaceId}`;
      const workspace = await db.workspace.get(pk, "workspace");
      if (!workspace) {
        return JSON.stringify({ error: "Workspace not found" });
      }
      return JSON.stringify(
        {
          id: workspaceId,
          name: workspace.name,
          description: workspace.description ?? "",
          creditBalance: workspace.creditBalance ?? 0,
          currency: workspace.currency ?? "usd",
          subscriptionId: workspace.subscriptionId ?? undefined,
        },
        null,
        2
      );
    },
  });

  tools.update_workspace = tool({
    description:
      "Update workspace name and/or description. Pass only the fields to change.",
    parameters: z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
      })
      .strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = z
        .object({
          name: z.string().min(1).optional(),
          description: z.string().optional(),
        })
        .strict()
        .parse(args);
      await requireWorkspaceWrite(workspaceId, userId);
      const db = await database();
      const pk = `workspaces/${workspaceId}`;
      const existing = await db.workspace.get(pk, "workspace");
      if (!existing) {
        return JSON.stringify({ error: "Workspace not found" });
      }
      await db.workspace.update({
        pk,
        sk: "workspace",
        name: parsed.name ?? existing.name,
        description: parsed.description ?? existing.description ?? "",
        currency: "usd",
        suggestions: null,
        updatedBy: userId ? `users/${userId}` : "",
        updatedAt: new Date().toISOString(),
      });
      return "Workspace updated successfully.";
    },
  });

  tools.list_agents = tool({
    description:
      "List all agents in the workspace. Returns id, name, and a short summary for each agent.",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      await requireWorkspaceRead(workspaceId, userId);
      const db = await database();
      const agentsResult = await db.agent.query({
        IndexName: "byWorkspaceId",
        KeyConditionExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: { ":workspaceId": workspaceId },
      });
      const agents = agentsResult?.items ?? [];
      const list = agents.map((a: { pk: string; name: string; systemPrompt?: string }) => {
        const agentId = a.pk.replace(`agents/${workspaceId}/`, "");
        return {
          id: agentId,
          name: a.name,
          systemPromptPreview:
            typeof a.systemPrompt === "string"
              ? a.systemPrompt.slice(0, 200) + (a.systemPrompt.length > 200 ? "..." : "")
              : "",
        };
      });
      return JSON.stringify(list, null, 2);
    },
  });

  tools.list_workspace_members = tool({
    description:
      "List all members of the workspace with their userId, email, permission level (1=READ, 2=WRITE, 3=OWNER), and join date.",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      await requireWorkspaceRead(workspaceId, userId);
      const db = await database();
      const workspaceResource = `workspaces/${workspaceId}`;
      const permissions = await db.permission.query({
        KeyConditionExpression: "pk = :workspacePk",
        ExpressionAttributeValues: { ":workspacePk": workspaceResource },
      });
      const members = await Promise.all(
        (permissions.items ?? []).map(
          async (permission: { sk: string; type: number; createdAt?: string }) => {
            const uid = permission.sk.replace("users/", "");
            const email = await getUserEmailById(uid);
            return {
              userId: uid,
              userRef: permission.sk,
              email: email ?? undefined,
              permissionLevel: permission.type,
              createdAt: permission.createdAt,
            };
          }
        )
      );
      return JSON.stringify({ members }, null, 2);
    },
  });

  const inviteMemberSchema = z
    .object({
      email: z.string().email(),
      permissionLevel: z
        .union([z.literal(1), z.literal(2), z.literal(3)])
        .default(1),
    })
    .strict();
  tools.invite_member = tool({
    description:
      "Invite a user to the workspace by email. Requires owner access. permissionLevel: 1=READ, 2=WRITE, 3=OWNER.",
    parameters: inviteMemberSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { email, permissionLevel } = inviteMemberSchema.parse(args);
      const currentUserRef = await requireWorkspaceOwner(workspaceId, userId);
      const db = await database();
      const workspacePk = `workspaces/${workspaceId}`;
      const workspace = await db.workspace.get(workspacePk, "workspace");
      if (!workspace) {
        return JSON.stringify({ error: "Workspace not found" });
      }
      const level =
        permissionLevel === 1 || permissionLevel === 2 || permissionLevel === 3
          ? permissionLevel
          : PERMISSION_LEVELS.READ;
      try {
        const invite = await createWorkspaceInvite(
          workspaceId,
          email.toLowerCase().trim(),
          level,
          currentUserRef
        );
        const inviterEmail = userId ? await getUserEmailById(userId) : undefined;
        if (inviterEmail) {
          await sendInviteEmail(invite, workspace, inviterEmail);
        }
        return `Invite sent to ${email} with permission level ${level}.`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("already has access") || message.includes("pending invite")) {
          return `Could not send invite: ${message}`;
        }
        throw err;
      }
    },
  });

  const updateMemberRoleSchema = z
    .object({
      userId: z.string().min(1),
      permissionLevel: z.union([
        z.literal(1),
        z.literal(2),
        z.literal(3),
      ]),
    })
    .strict();
  tools.update_member_role = tool({
    description:
      "Update a member's permission level (1=READ, 2=WRITE, 3=OWNER). You cannot grant a level higher than your own.",
    parameters: updateMemberRoleSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { userId: memberUserId, permissionLevel } =
        updateMemberRoleSchema.parse(args);
      await requireWorkspaceWrite(workspaceId, userId);
      const workspaceResource = `workspaces/${workspaceId}`;
      const currentUserRef = userId ? userRef(userId) : "";
      if (!currentUserRef) {
        throw new Error("Authentication required");
      }
      const granterLevel = await getUserAuthorizationLevelForResource(
        workspaceResource,
        currentUserRef
      );
      if (!granterLevel || granterLevel < permissionLevel) {
        throw new Error(
          "Cannot grant permission level higher than your own"
        );
      }
      const memberUserRef = userRef(memberUserId);
      await ensureExactAuthorization(
        workspaceResource,
        memberUserRef,
        permissionLevel,
        currentUserRef
      );
      return `Member ${memberUserId} permission updated to ${permissionLevel}.`;
    },
  });

  const removeMemberSchema = z.object({ userId: z.string().min(1) }).strict();
  tools.remove_member = tool({
    description:
      "Remove a member from the workspace. Cannot remove the last owner. Requires owner access.",
    parameters: removeMemberSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { userId: memberUserId } = removeMemberSchema.parse(args);
      await requireWorkspaceOwner(workspaceId, userId);
      const db = await database();
      const workspaceResource = `workspaces/${workspaceId}`;
      const memberUserRef = userRef(memberUserId);
      const permission = await db.permission.get(
        workspaceResource,
        memberUserRef
      );
      if (!permission) {
        return JSON.stringify({ error: "Member not found in workspace" });
      }
      const workspace = await db.workspace.get(workspaceResource, "workspace");
      if (!workspace) {
        return JSON.stringify({ error: "Workspace not found" });
      }
      if (permission.type === PERMISSION_LEVELS.OWNER) {
        const allPermissions = await db.permission.query({
          KeyConditionExpression: "pk = :workspacePk",
          ExpressionAttributeValues: { ":workspacePk": workspaceResource },
        });
        const ownerCount = (allPermissions.items ?? []).filter(
          (p: { type: number }) => p.type === PERMISSION_LEVELS.OWNER
        ).length;
        if (ownerCount <= 1) {
          throw new Error(
            "Cannot remove the last owner. The workspace must have at least one owner."
          );
        }
      }
      await db.permission.delete(workspaceResource, memberUserRef);
      return `Member ${memberUserId} removed from the workspace.`;
    },
  });

  tools.list_documents = tool({
    description:
      "List all documents in the workspace. Optionally filter by folder path.",
    parameters: z
      .object({
        folder: z.string().optional(),
      })
      .strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { folder } = z
        .object({ folder: z.string().optional() })
        .strict()
        .parse(args);
      await requireWorkspaceRead(workspaceId, userId);
      const db = await database();
      const documents = await db["workspace-document"].query({
        IndexName: "byWorkspaceId",
        KeyConditionExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: { ":workspaceId": workspaceId },
      });
      let items = documents.items ?? [];
      if (folder !== undefined) {
        const normalized = normalizeFolderPath(folder ?? "");
        items = items.filter(
          (doc: { folderPath: string }) => doc.folderPath === normalized
        );
      }
      const list = items.map(
        (doc: {
          pk: string;
          name: string;
          filename: string;
          folderPath: string;
          contentType: string;
          size: number;
          createdAt: string;
          updatedAt?: string;
        }) => ({
          id: doc.pk.replace(`workspace-documents/${workspaceId}/`, ""),
          name: doc.name,
          filename: doc.filename,
          folderPath: doc.folderPath,
          contentType: doc.contentType,
          size: doc.size,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt ?? doc.createdAt,
        })
      );
      return JSON.stringify({ documents: list }, null, 2);
    },
  });

  tools.get_document = tool({
    description: "Get a document by ID: metadata and text content.",
    parameters: z.object({ documentId: z.string().min(1) }).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { documentId } = z
        .object({ documentId: z.string().min(1) })
        .strict()
        .parse(args);
      await requireWorkspaceRead(workspaceId, userId);
      const db = await database();
      const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
      const document = await db["workspace-document"].get(
        documentPk,
        "document"
      );
      if (!document) {
        return JSON.stringify({ error: "Document not found" });
      }
      const content = await getDocument(
        workspaceId,
        documentId,
        document.s3Key
      );
      return JSON.stringify(
        {
          id: documentId,
          name: document.name,
          filename: document.filename,
          folderPath: document.folderPath,
          contentType: document.contentType,
          size: document.size,
          content: content.toString("utf-8"),
          createdAt: document.createdAt,
          updatedAt: document.updatedAt ?? document.createdAt,
        },
        null,
        2
      );
    },
  });

  const createDocumentSchema = z
    .object({
      name: z.string().min(1),
      content: z.string().min(1),
      folderPath: z.string().optional(),
    })
    .strict();
  tools.create_document = tool({
    description:
      "Create a new text document in the workspace. Provide name (e.g. 'readme.md'), content, and optional folderPath.",
    parameters: createDocumentSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = createDocumentSchema.parse(args);
      await requireWorkspaceWrite(workspaceId, userId);
      if (!userId) {
        throw new Error("Authentication required");
      }
      const subscriptionId = await ensureWorkspaceSubscription(
        workspaceId,
        userId
      );
      await checkSubscriptionLimits(subscriptionId, "document", 1, parsed.content.length);
      const db = await database();
      const documentId = randomUUID();
      const folderPath = normalizeFolderPath(parsed.folderPath ?? "");
      const filename =
        parsed.name.endsWith(".md") ||
        parsed.name.endsWith(".txt") ||
        parsed.name.endsWith(".markdown")
          ? parsed.name
          : `${parsed.name}.txt`;
      const s3Key = await uploadDocument(
        workspaceId,
        documentId,
        parsed.content,
        filename,
        "text/plain",
        folderPath
      );
      const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
      await db["workspace-document"].create({
        pk: documentPk,
        sk: "document",
        workspaceId,
        name: parsed.name,
        filename,
        folderPath,
        s3Key,
        contentType: "text/plain",
        size: Buffer.byteLength(parsed.content, "utf-8"),
      });
      await indexDocument(workspaceId, documentId, parsed.content, {
        documentName: parsed.name,
        folderPath,
      }).catch((err) => {
        console.error("[workspaceAgentTools] indexDocument failed:", err);
      });
      return JSON.stringify({
        id: documentId,
        name: parsed.name,
        folderPath,
        message: "Document created.",
      });
    },
  });

  const updateDocumentSchema = z
    .object({
      documentId: z.string().min(1),
      name: z.string().min(1).optional(),
      content: z.string().optional(),
    })
    .strict();
  tools.update_document = tool({
    description:
      "Update a document's name and/or content. Pass documentId and the fields to change.",
    parameters: updateDocumentSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = updateDocumentSchema.parse(args);
      await requireWorkspaceWrite(workspaceId, userId);
      const db = await database();
      const documentPk = `workspace-documents/${workspaceId}/${parsed.documentId}`;
      const document = await db["workspace-document"].get(
        documentPk,
        "document"
      );
      if (!document) {
        return JSON.stringify({ error: "Document not found" });
      }
      if (parsed.name !== undefined) {
        document.name = parsed.name;
      }
      if (parsed.content !== undefined) {
        const s3Key = await uploadDocument(
          workspaceId,
          parsed.documentId,
          parsed.content,
          document.filename,
          document.contentType,
          document.folderPath
        );
        document.s3Key = s3Key;
        document.size = Buffer.byteLength(parsed.content, "utf-8");
        await indexDocument(workspaceId, parsed.documentId, parsed.content, {
          documentName: document.name,
          folderPath: document.folderPath,
        }).catch((err) => {
          console.error("[workspaceAgentTools] indexDocument failed:", err);
        });
      }
      document.updatedAt = new Date().toISOString();
      await db["workspace-document"].update(document);
      return "Document updated successfully.";
    },
  });

  const deleteDocumentSchema = z
    .object({ documentId: z.string().min(1) })
    .strict();
  tools.delete_document = tool({
    description: "Delete a document from the workspace.",
    parameters: deleteDocumentSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { documentId } = deleteDocumentSchema.parse(args);
      await requireWorkspaceWrite(workspaceId, userId);
      const db = await database();
      const documentPk = `workspace-documents/${workspaceId}/${documentId}`;
      const document = await db["workspace-document"].get(
        documentPk,
        "document"
      );
      if (!document) {
        return JSON.stringify({ error: "Document not found" });
      }
      const { deleteDocumentSnippets } = await import(
        "../../utils/documentIndexing"
      );
      await deleteDocumentSnippets(workspaceId, documentId).catch((err) => {
        console.error("[workspaceAgentTools] deleteDocumentSnippets failed:", err);
      });
      await deleteDocument(workspaceId, documentId, document.s3Key);
      await db["workspace-document"].delete(documentPk, "document");
      return "Document deleted successfully.";
    },
  });

  tools.get_agent = tool({
    description: "Get details for a specific agent by ID (from list_agents).",
    parameters: z.object({ agentId: z.string().min(1) }).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { agentId } = z
        .object({ agentId: z.string().min(1) })
        .strict()
        .parse(args);
      if (RESERVED_AGENT_IDS.includes(agentId as (typeof RESERVED_AGENT_IDS)[number])) {
        return JSON.stringify({
          error:
            "The workspace agent is a virtual agent; use list_agents to get specific agent IDs.",
        });
      }
      await requireWorkspaceRead(workspaceId, userId);
      const db = await database();
      const agentPk = `agents/${workspaceId}/${agentId}`;
      const agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        return JSON.stringify({ error: "Agent not found" });
      }
      const fetchWebProvider =
        agent.fetchWebProvider ??
        (agent.enableTavilyFetch === true ? "tavily" : undefined);
      const searchWebProvider =
        agent.searchWebProvider ??
        (agent.enableTavilySearch === true ? "tavily" : undefined);
      return JSON.stringify(
        {
          id: agentId,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          modelName: agent.modelName ?? null,
          provider: agent.provider,
          delegatableAgentIds: agent.delegatableAgentIds ?? [],
          enableMemorySearch: agent.enableMemorySearch ?? false,
          enableSearchDocuments: agent.enableSearchDocuments ?? false,
          enableKnowledgeInjection: agent.enableKnowledgeInjection ?? false,
          enableSendEmail: agent.enableSendEmail ?? false,
          searchWebProvider: searchWebProvider ?? null,
          fetchWebProvider: fetchWebProvider ?? null,
          enableImageGeneration: agent.enableImageGeneration ?? false,
          spendingLimits: agent.spendingLimits ?? [],
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
        },
        null,
        2
      );
    },
  });

  const createAgentToolSchema = z
    .object({
      name: z.string().min(1),
      systemPrompt: z.string().min(1),
      modelName: z.string().nullable().optional(),
    })
    .strict();
  tools.create_agent = tool({
    description:
      "Create a new agent in the workspace. Provide name, systemPrompt, and optionally modelName.",
    parameters: createAgentToolSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = createAgentToolSchema.parse(args);
      await requireWorkspaceWrite(workspaceId, userId);
      if (!userId) {
        throw new Error("Authentication required");
      }
      const subscriptionId = await ensureWorkspaceSubscription(
        workspaceId,
        userId
      );
      await checkSubscriptionLimits(subscriptionId, "agent", 1);
      const db = await database();
      const agentId = randomUUID();
      const agentPk = `agents/${workspaceId}/${agentId}`;
      const currentUserRef = userRef(userId);
      const { getRandomAvatar } = await import("../../utils/avatarUtils");
      const modelName =
        typeof parsed.modelName === "string" && parsed.modelName.trim()
          ? parsed.modelName.trim()
          : undefined;
      if (modelName) {
        const { getModelPricing } = await import("../../utils/pricing");
        const pricing = getModelPricing("openrouter", modelName);
        if (!pricing) {
          return JSON.stringify({
            error: `Model "${modelName}" is not available. Check available models at /api/models.`,
          });
        }
      }
      const agent = await db.agent.create({
        pk: agentPk,
        sk: "agent",
        workspaceId,
        name: parsed.name,
        systemPrompt: parsed.systemPrompt,
        provider: "openrouter",
        modelName,
        avatar: getRandomAvatar(),
        createdBy: currentUserRef,
      });
      return JSON.stringify(
        {
          id: agentId,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          modelName: agent.modelName ?? null,
          message: "Agent created.",
        },
        null,
        2
      );
    },
  });

  const deleteAgentSchema = z
    .object({
      agentId: z.string().min(1),
      confirm: z.literal(true).describe("Set to true to confirm deletion"),
    })
    .strict();
  tools.delete_agent = tool({
    description:
      "Delete an agent from the workspace. Requires confirm: true. Confirm with the user in conversation before calling.",
    parameters: deleteAgentSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { agentId } = deleteAgentSchema.parse(args);
      if (RESERVED_AGENT_IDS.includes(agentId as (typeof RESERVED_AGENT_IDS)[number])) {
        return JSON.stringify({ error: "Cannot delete the workspace agent." });
      }
      await requireWorkspaceWrite(workspaceId, userId);
      const db = await database();
      const agentPk = `agents/${workspaceId}/${agentId}`;
      const agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        return JSON.stringify({ error: "Agent not found" });
      }
      await removeAgentResources({ db, workspaceId, agentId });
      return "Agent deleted successfully.";
    },
  });

  tools.list_integrations = tool({
    description:
      "List bot integrations for the workspace (e.g. Slack, Discord). Returns id, platform, name, agentId, status.",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      await requireWorkspaceRead(workspaceId, userId);
      const db = await database();
      const result = await db["bot-integration"].query({
        IndexName: "byWorkspaceId",
        KeyConditionExpression: "workspaceId = :workspaceId",
        ExpressionAttributeValues: { ":workspaceId": workspaceId },
      });
      const integrations = (result.items ?? []).map(
        (integration: {
          pk: string;
          platform: string;
          name: string;
          agentId: string;
          webhookUrl: string;
          status: string;
          lastUsedAt?: string;
        }) => ({
          id: integration.pk.split("/").pop(),
          platform: integration.platform,
          name: integration.name,
          agentId: integration.agentId.replace(`agents/${workspaceId}/`, ""),
          status: integration.status,
          lastUsedAt: integration.lastUsedAt ?? null,
        })
      );
      return JSON.stringify(integrations, null, 2);
    },
  });

  tools.get_workspace_usage = tool({
    description:
      "Get usage statistics for the workspace (tokens, cost, conversation count) for the last 30 days.",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      await requireWorkspaceRead(workspaceId, userId);
      const db = await database();
      const endDate = new Date();
      const startDate = new Date(
        endDate.getTime() - 30 * 24 * 60 * 60 * 1000
      );
      const stats = await queryUsageStats(db, {
        workspaceId,
        startDate,
        endDate,
      });
      const totalCost =
        (stats.costUsd ?? 0) +
        (stats.rerankingCostUsd ?? 0) +
        (stats.evalCostUsd ?? 0);
      return JSON.stringify(
        {
          workspaceId,
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
          stats: {
            inputTokens: stats.inputTokens,
            outputTokens: stats.outputTokens,
            totalTokens: stats.totalTokens,
            costUsd: totalCost,
            conversationCount: stats.conversationCount,
            messagesIn: stats.messagesIn,
            messagesOut: stats.messagesOut,
          },
        },
        null,
        2
      );
    },
  });

  tools.get_spending_limits = tool({
    description:
      "Get the workspace's spending limits (daily, weekly, monthly caps in USD).",
    parameters: z.object({}).strict(),
    // @ts-expect-error - AI SDK execute signature
    execute: async () => {
      await requireWorkspaceRead(workspaceId, userId);
      const db = await database();
      const workspacePk = `workspaces/${workspaceId}`;
      const workspace = await db.workspace.get(workspacePk, "workspace");
      if (!workspace) {
        return JSON.stringify({ error: "Workspace not found" });
      }
      return JSON.stringify(
        { spendingLimits: workspace.spendingLimits ?? [] },
        null,
        2
      );
    },
  });

  const updateSpendingLimitSchema = z
    .object({
      timeFrame: z.enum(["daily", "weekly", "monthly"]),
      amount: z.number().int().nonnegative(),
    })
    .strict();
  tools.update_spending_limits = tool({
    description:
      "Set or update a spending limit for the workspace. timeFrame: daily, weekly, or monthly; amount in USD.",
    parameters: updateSpendingLimitSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const parsed = updateSpendingLimitSchema.parse(args);
      await requireWorkspaceWrite(workspaceId, userId);
      const db = await database();
      const existing = await db.workspace.get(
        `workspaces/${workspaceId}`,
        "workspace"
      );
      if (!existing) {
        return JSON.stringify({ error: "Workspace not found" });
      }
      const hasLimit = (existing.spendingLimits ?? []).some(
        (l: { timeFrame: string }) => l.timeFrame === parsed.timeFrame
      );
      if (hasLimit) {
        await updateSpendingLimit(
          db,
          workspaceId,
          parsed.timeFrame,
          parsed.amount
        );
      } else {
        await addSpendingLimit(db, workspaceId, {
          timeFrame: parsed.timeFrame,
          amount: parsed.amount,
        });
      }
      return `Spending limit ${parsed.timeFrame} set to $${parsed.amount}.`;
    },
  });

  const configureAgentSchema = z
    .object({
      agentId: z.string().min(1, "agentId is required"),
      message: z.string().min(1, "message is required"),
    })
    .strict();

  tools.configure_agent = tool({
    description:
      "Delegate to the meta-agent for a specific agent to change its configuration. Use this when the user wants to update an agent's system prompt, model, tools, schedules, or other settings. Pass the agent ID (from list_agents) and a clear message describing what to change.",
    parameters: configureAgentSchema,
    // @ts-expect-error - AI SDK execute signature
    execute: async (args: unknown) => {
      const { agentId, message } = configureAgentSchema.parse(args);
      if (RESERVED_AGENT_IDS.includes(agentId as (typeof RESERVED_AGENT_IDS)[number])) {
        return JSON.stringify({
          error: "Cannot configure the workspace agent; use a specific agent ID from list_agents.",
        });
      }
      await requireWorkspaceWrite(workspaceId, userId);
      const db = await database();
      const agentPk = `agents/${workspaceId}/${agentId}`;
      const agent = await db.agent.get(agentPk, "agent");
      if (!agent) {
        return JSON.stringify({ error: "Agent not found" });
      }
      const { callAgentInternal } = await import("./call-agent-internal");
      const result = await callAgentInternal(
        workspaceId,
        agentId,
        message.trim(),
        0,
        3,
        undefined,
        60_000,
        undefined,
        WORKSPACE_AGENT_ID,
        undefined,
        { configurationMode: true, userId }
      );
      return result.response;
    },
  });

  return tools;
}

/**
 * Sets up the workspace agent: descriptor, model, and tools.
 * Used when stream path indicates the workspace agent (agentId === _workspace).
 */
export async function setupWorkspaceAgentAndTools(
  workspaceId: string,
  options?: WorkspaceAgentSetupOptions
): Promise<WorkspaceAgentSetup> {
  const agent = createWorkspaceAgentDescriptor(workspaceId);
  const workspaceApiKey = await getWorkspaceApiKey(workspaceId, "openrouter");
  const usesByok = workspaceApiKey !== null;
  const modelName = getDefaultModel();

  const model = await createAgentModel(
    options?.modelReferer ?? "https://app.helpmaton.com",
    workspaceApiKey ?? undefined,
    modelName,
    workspaceId,
    WORKSPACE_AGENT_ID,
    usesByok,
    options?.userId,
    "openrouter",
    {},
    options?.llmObserver
  );

  const rawTools = createWorkspaceAgentTools(
    workspaceId,
    options?.userId
  );
  const tools = wrapToolsWithObserver(rawTools, options?.llmObserver);

  return {
    agent,
    model,
    tools,
    usesByok,
  };
}
