import { resourceGone } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted
const { mockDatabase, mockGenerateToolList } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
    mockGenerateToolList: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

vi.mock("../../../../utils/toolMetadata", () => ({
  generateToolList: mockGenerateToolList,
}));

describe("GET /api/workspaces/:workspaceId/agents/:agentId/tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);
  });

  async function callRouteHandler(
    req: Partial<express.Request>,
    res: Partial<express.Response>,
    next: express.NextFunction
  ) {
    // Extract the handler logic directly
    const handler = async (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      try {
        const db = await mockDatabase();
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        // Load agent
        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        // Check email connection
        const emailConnectionPk = `email-connections/${workspaceId}`;
        const emailConnection = await db["email-connection"].get(
          emailConnectionPk,
          "connection"
        );
        const hasEmailConnection = !!emailConnection;

        // Load enabled MCP servers
        const enabledMcpServerIds = agent.enabledMcpServerIds || [];
        const enabledMcpServers = [];

        for (const serverId of enabledMcpServerIds) {
          const serverPk = `mcp-servers/${workspaceId}/${serverId}`;
          const server = await db["mcp-server"].get(serverPk, "server");
          if (server && server.workspaceId === workspaceId) {
            // Check for OAuth connection
            const config = server.config as { accessToken?: string };
            const hasOAuthConnection = !!config.accessToken;

            enabledMcpServers.push({
              id: serverId,
              name: server.name,
              serviceType: server.serviceType,
              authType: server.authType,
              oauthConnected: hasOAuthConnection,
            });
          }
        }

        // Generate tool list
        const toolList = mockGenerateToolList({
          agent: {
            enableSearchDocuments: agent.enableSearchDocuments ?? false,
            enableMemorySearch: agent.enableMemorySearch ?? false,
            notificationChannelId: agent.notificationChannelId,
            enableSendEmail: agent.enableSendEmail ?? false,
            searchWebProvider: agent.searchWebProvider ?? null,
            fetchWebProvider: agent.fetchWebProvider ?? null,
            enableExaSearch: agent.enableExaSearch ?? false,
            enableImageGeneration: agent.enableImageGeneration ?? false,
            imageGenerationModel: agent.imageGenerationModel,
            delegatableAgentIds: agent.delegatableAgentIds ?? [],
            enabledMcpServerIds: agent.enabledMcpServerIds ?? [],
            enabledMcpServerToolNames:
              agent.enabledMcpServerToolNames ?? undefined,
            clientTools: agent.clientTools ?? [],
          },
          workspaceId,
          enabledMcpServers,
          emailConnection: hasEmailConnection,
        });

        res.json(toolList);
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should return tool list for agent with basic configuration", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      enableSearchDocuments: false,
      enableMemorySearch: false,
      enableSendEmail: false,
      searchWebProvider: null,
      fetchWebProvider: null,
      enableExaSearch: false,
      enableImageGeneration: false,
      imageGenerationModel: undefined,
      delegatableAgentIds: [],
      enabledMcpServerIds: [],
      clientTools: [],
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    mockDatabase.mockResolvedValue(mockDb);

    const mockToolList = [
      {
        category: "Core Tools",
        tools: [
          {
            name: "get_datetime",
            description: "Get the current date and time",
            category: "Core Tools",
            alwaysAvailable: true,
            parameters: [],
          },
        ],
      },
    ];
    mockGenerateToolList.mockReturnValue(mockToolList);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockDb.agent.get).toHaveBeenCalledWith(
      "agents/workspace-123/agent-123",
      "agent"
    );
    expect(mockGenerateToolList).toHaveBeenCalledWith({
      agent: {
        enableSearchDocuments: false,
        enableMemorySearch: false,
        notificationChannelId: undefined,
        enableSendEmail: false,
        searchWebProvider: null,
        fetchWebProvider: null,
        enableExaSearch: false,
        enableImageGeneration: false,
        imageGenerationModel: undefined,
        delegatableAgentIds: [],
        enabledMcpServerIds: [],
        enabledMcpServerToolNames: undefined,
        clientTools: [],
      },
      workspaceId: "workspace-123",
      enabledMcpServers: [],
      emailConnection: false,
    });
    expect(res.json).toHaveBeenCalledWith(mockToolList);
    expect(res.statusCode).toBe(200);
  });

  it("should return 410 if agent is not found", async () => {
    const mockDb = createMockDatabase();
    mockDb.agent.get = vi.fn().mockResolvedValue(null);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 410,
          payload: expect.objectContaining({
            message: "Agent not found",
          }),
        }),
      })
    );
    expect(mockGenerateToolList).not.toHaveBeenCalled();
  });

  it("should include email connection status when email connection exists", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      enableSendEmail: true,
      enabledMcpServerIds: [],
      clientTools: [],
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue({
        pk: "email-connections/workspace-123",
        sk: "connection",
        workspaceId: "workspace-123",
      }),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    mockDatabase.mockResolvedValue(mockDb);

    mockGenerateToolList.mockReturnValue([]);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGenerateToolList).toHaveBeenCalledWith(
      expect.objectContaining({
        emailConnection: true,
      })
    );
  });

  it("should load and include MCP servers when enabled", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      enabledMcpServerIds: ["server-1", "server-2"],
      clientTools: [],
    };

    const mockMcpServer1 = {
      pk: "mcp-servers/workspace-123/server-1",
      sk: "server",
      workspaceId: "workspace-123",
      name: "GitHub Server",
      serviceType: "github",
      authType: "oauth",
      config: { accessToken: "token-123" },
    };

    const mockMcpServer2 = {
      pk: "mcp-servers/workspace-123/server-2",
      sk: "server",
      workspaceId: "workspace-123",
      name: "Notion Server",
      serviceType: "notion",
      authType: "oauth",
      config: {},
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi
        .fn()
        .mockResolvedValueOnce(mockMcpServer1)
        .mockResolvedValueOnce(mockMcpServer2),
    };
    mockDatabase.mockResolvedValue(mockDb);

    mockGenerateToolList.mockReturnValue([]);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockDb["mcp-server"].get).toHaveBeenCalledTimes(2);
    expect(mockDb["mcp-server"].get).toHaveBeenCalledWith(
      "mcp-servers/workspace-123/server-1",
      "server"
    );
    expect(mockDb["mcp-server"].get).toHaveBeenCalledWith(
      "mcp-servers/workspace-123/server-2",
      "server"
    );

    expect(mockGenerateToolList).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledMcpServers: [
          {
            id: "server-1",
            name: "GitHub Server",
            serviceType: "github",
            authType: "oauth",
            oauthConnected: true,
          },
          {
            id: "server-2",
            name: "Notion Server",
            serviceType: "notion",
            authType: "oauth",
            oauthConnected: false,
          },
        ],
      })
    );
  });

  it("should filter out MCP servers that don't belong to workspace", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      enabledMcpServerIds: ["server-1"],
      clientTools: [],
    };

    const mockMcpServer = {
      pk: "mcp-servers/workspace-123/server-1",
      sk: "server",
      workspaceId: "workspace-456", // Different workspace
      name: "Other Server",
      serviceType: "github",
      authType: "oauth",
      config: {},
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue(null),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi.fn().mockResolvedValue(mockMcpServer),
    };
    mockDatabase.mockResolvedValue(mockDb);

    mockGenerateToolList.mockReturnValue([]);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    // Server should be filtered out because workspaceId doesn't match
    expect(mockGenerateToolList).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledMcpServers: [],
      })
    );
  });

  it("should handle agent with all features enabled", async () => {
    const mockDb = createMockDatabase();
    const mockAgent = {
      pk: "agents/workspace-123/agent-123",
      sk: "agent",
      workspaceId: "workspace-123",
      name: "Test Agent",
      enableSearchDocuments: true,
      enableMemorySearch: true,
      notificationChannelId: "channel-123",
      enableSendEmail: true,
      searchWebProvider: "tavily",
      fetchWebProvider: "tavily",
      enableExaSearch: true,
      delegatableAgentIds: ["agent-1", "agent-2"],
      enabledMcpServerIds: ["server-1"],
      clientTools: [
        {
          name: "custom_tool",
          description: "Custom tool",
          parameters: {},
        },
      ],
    };

    mockDb.agent.get = vi.fn().mockResolvedValue(mockAgent);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: vi.fn().mockResolvedValue({
        pk: "email-connections/workspace-123",
        sk: "connection",
      }),
    };
    (mockDb as Record<string, unknown>)["mcp-server"] = {
      get: vi.fn().mockResolvedValue({
        pk: "mcp-servers/workspace-123/server-1",
        sk: "server",
        workspaceId: "workspace-123",
        name: "GitHub Server",
        serviceType: "github",
        authType: "oauth",
        config: { accessToken: "token" },
      }),
    };
    mockDatabase.mockResolvedValue(mockDb);

    mockGenerateToolList.mockReturnValue([]);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
    });

    const res = createMockResponse();
    const next = createMockNext();

    await callRouteHandler(req, res, next);

    expect(mockGenerateToolList).toHaveBeenCalledWith({
      agent: {
        enableSearchDocuments: true,
        enableMemorySearch: true,
        notificationChannelId: "channel-123",
        enableSendEmail: true,
        searchWebProvider: "tavily",
        fetchWebProvider: "tavily",
        enableExaSearch: true,
        enableImageGeneration: false,
        delegatableAgentIds: ["agent-1", "agent-2"],
        enabledMcpServerIds: ["server-1"],
        enabledMcpServerToolNames: undefined,
        imageGenerationModel: undefined,
        clientTools: [
          {
            name: "custom_tool",
            description: "Custom tool",
            parameters: {},
          },
        ],
      },
      workspaceId: "workspace-123",
      enabledMcpServers: [
        {
          id: "server-1",
          name: "GitHub Server",
          serviceType: "github",
          authType: "oauth",
          oauthConnected: true,
        },
      ],
      emailConnection: true,
    });
  });

  it("should handle errors gracefully", async () => {
    const mockDb = createMockDatabase();
    const error = new Error("Database error");
    mockDb.agent.get = vi.fn().mockRejectedValue(error);
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      userRef: "users/user-123",
      workspaceResource: "workspaces/workspace-123",
      params: { workspaceId: "workspace-123", agentId: "agent-123" },
    });

    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
