import { describe, it, expect, vi, beforeEach } from "vitest";

import type { SuggestionsCache } from "../suggestions";
import {
  resolveWorkspaceSuggestions,
  buildWorkspaceSuggestionContext,
  buildAgentSuggestionContext,
  dismissSuggestion,
} from "../suggestions";

type SuggestionsDb = Parameters<typeof resolveWorkspaceSuggestions>[0]["db"];

const { mockGenerateText, mockCreateModel, mockGetDefaultModel } = vi.hoisted(
  () => {
    return {
      mockGenerateText: vi.fn(),
      mockCreateModel: vi.fn(),
      mockGetDefaultModel: vi.fn(),
    };
  },
);

vi.mock("ai", () => ({
  generateText: mockGenerateText,
}));

vi.mock("../modelFactory", () => ({
  createModel: mockCreateModel,
  getDefaultModel: mockGetDefaultModel,
}));

const createMockDb = () => {
  const queryPaginated = vi.fn().mockResolvedValue({ items: [] });
  return {
    workspace: {
      update: vi.fn(),
    },
    agent: {
      update: vi.fn(),
      queryPaginated,
    },
    "mcp-server": {
      queryPaginated,
    },
    "email-connection": {
      queryPaginated,
    },
    "workspace-document": {
      queryPaginated,
    },
    output_channel: {
      queryPaginated,
    },
  };
};

describe("suggestions utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateModel.mockResolvedValue({});
    mockGetDefaultModel.mockReturnValue("openrouter/mock-model");
  });

  it("generates and caches workspace suggestions", async () => {
    const db = createMockDb();
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        suggestions: ["Connect tools", "Upload your documents"],
      }),
    });

    const workspace: {
      name: string;
      description: string;
      creditBalance: number;
      spendingLimits: never[];
      suggestions: SuggestionsCache | null;
    } = {
      name: "Workspace One",
      description: "Test",
      creditBalance: 0,
      spendingLimits: [],
      suggestions: null,
    };

    const result = await resolveWorkspaceSuggestions({
      db: db as unknown as SuggestionsDb,
      workspaceId: "workspace-1",
      workspacePk: "workspaces/workspace-1",
      workspace,
      apiKeys: { openrouter: false },
    });

    expect(result?.items).toHaveLength(2);
    expect(db.workspace.update).toHaveBeenCalledTimes(1);
    const updateCall = (db.workspace.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(updateCall.suggestions.items).toHaveLength(2);
    expect(updateCall.suggestions.generatedAt).toBeDefined();
  });

  it("accepts more than 3 suggestions from LLM and uses only the first 3", async () => {
    const db = createMockDb();
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        suggestions: [
          "First suggestion",
          "Second suggestion",
          "Third suggestion",
          "Fourth suggestion",
          "Fifth suggestion",
        ],
      }),
    });

    const workspace: {
      name: string;
      description: string;
      creditBalance: number;
      spendingLimits: never[];
      suggestions: SuggestionsCache | null;
    } = {
      name: "Workspace One",
      description: "Test",
      creditBalance: 0,
      spendingLimits: [],
      suggestions: null,
    };

    const result = await resolveWorkspaceSuggestions({
      db: db as unknown as SuggestionsDb,
      workspaceId: "workspace-1",
      workspacePk: "workspaces/workspace-1",
      workspace,
      apiKeys: { openrouter: false },
    });

    expect(result?.items).toHaveLength(3);
    expect(result?.items?.map((i) => i.text)).toEqual([
      "First suggestion",
      "Second suggestion",
      "Third suggestion",
    ]);
    const updateCall = (db.workspace.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(updateCall.suggestions.items).toHaveLength(3);
  });

  it("reuses cached workspace suggestions when context is unchanged", async () => {
    const db = createMockDb();
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        suggestions: ["Connect tools"],
      }),
    });

    const workspace: {
      name: string;
      description: string;
      creditBalance: number;
      spendingLimits: never[];
      suggestions: SuggestionsCache | null;
    } = {
      name: "Workspace One",
      description: "Test",
      creditBalance: 0,
      spendingLimits: [],
      suggestions: null,
    };

    const first = await resolveWorkspaceSuggestions({
      db: db as unknown as SuggestionsDb,
      workspaceId: "workspace-1",
      workspacePk: "workspaces/workspace-1",
      workspace,
      apiKeys: { openrouter: false },
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    workspace.suggestions = first ?? null;

    const second = await resolveWorkspaceSuggestions({
      db: db as unknown as SuggestionsDb,
      workspaceId: "workspace-1",
      workspacePk: "workspaces/workspace-1",
      workspace,
      apiKeys: { openrouter: false },
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(second?.items).toEqual(first?.items);
  });

  it("builds workspace context for suggestions", async () => {
    const db = createMockDb();
    const context = await buildWorkspaceSuggestionContext({
      db: db as unknown as SuggestionsDb,
      workspaceId: "workspace-1",
      workspace: {
        name: "Workspace One",
        description: null,
        creditBalance: 0,
        spendingLimits: [],
      },
      apiKeys: { openrouter: true },
    });

    expect(context.workspace.name).toBe("Workspace One");
    expect(context.connections.hasConnectedTools).toBe(false);
  });

  it("dismissSuggestion removes an existing suggestion", () => {
    const cache: SuggestionsCache = {
      items: [
        { id: "s1", text: "Connect tools" },
        { id: "s2", text: "Upload documents" },
      ],
      generatedAt: "2024-01-01T00:00:00Z",
      dismissedIds: [],
    };

    const updated = dismissSuggestion(cache, "s1");
    expect(updated?.items).toEqual([{ id: "s2", text: "Upload documents" }]);
    expect(updated?.dismissedIds).toEqual(["s1"]);
  });

  it("dismissSuggestion is a no-op for missing ids", () => {
    const cache: SuggestionsCache = {
      items: [{ id: "s1", text: "Connect tools" }],
      generatedAt: "2024-01-01T00:00:00Z",
      dismissedIds: [],
    };

    const updated = dismissSuggestion(cache, "missing");
    expect(updated).toEqual(cache);
  });

  it("dismissSuggestion handles null cache input", () => {
    const updated = dismissSuggestion(null, "s1");
    expect(updated).toBeNull();
  });

  it("dismissSuggestion tracks multiple sequential dismissals", () => {
    const cache: SuggestionsCache = {
      items: [
        { id: "s1", text: "Connect tools" },
        { id: "s2", text: "Upload documents" },
      ],
      generatedAt: "2024-01-01T00:00:00Z",
      dismissedIds: [],
    };

    const first = dismissSuggestion(cache, "s1");
    const second = dismissSuggestion(first, "s2");
    expect(second?.items).toEqual([]);
    expect(second?.dismissedIds).toEqual(["s1", "s2"]);
  });

  it("buildAgentSuggestionContext sets hasEnabledTools when agent has tools", () => {
    const workspaceContext = {
      workspace: {
        name: "Test",
        description: null,
        creditBalance: 0,
        spendingLimits: [],
        apiKeys: undefined,
      },
      connections: {
        hasConnectedTools: true,
        hasEmailConnection: false,
      },
      resources: {
        hasAgents: true,
        hasDocuments: false,
        hasOutputChannels: false,
      },
    };
    const context = buildAgentSuggestionContext({
      workspaceContext,
      agent: {
        name: "Agent",
        systemPrompt: "Help users",
        enableSearchDocuments: true,
        enabledSkillIds: [],
      },
    });
    expect(context.agent.hasEnabledTools).toBe(true);
    expect(context.agent.enabledSkillIds).toEqual([]);
  });

  it("buildAgentSuggestionContext sets hasEnabledTools false when agent has no tools", () => {
    const workspaceContext = {
      workspace: {
        name: "Test",
        description: null,
        creditBalance: 0,
        spendingLimits: [],
        apiKeys: undefined,
      },
      connections: {
        hasConnectedTools: false,
        hasEmailConnection: false,
      },
      resources: {
        hasAgents: true,
        hasDocuments: false,
        hasOutputChannels: false,
      },
    };
    const context = buildAgentSuggestionContext({
      workspaceContext,
      agent: {
        name: "Agent",
        systemPrompt: "Help users",
        enabledMcpServerIds: [],
        enabledSkillIds: [],
      },
    });
    expect(context.agent.hasEnabledTools).toBe(false);
  });

  it("buildAgentSuggestionContext includes enabledSkillIds", () => {
    const workspaceContext = {
      workspace: {
        name: "Test",
        description: null,
        creditBalance: 0,
        spendingLimits: [],
        apiKeys: undefined,
      },
      connections: {
        hasConnectedTools: true,
        hasEmailConnection: false,
      },
      resources: {
        hasAgents: true,
        hasDocuments: false,
        hasOutputChannels: false,
      },
    };
    const context = buildAgentSuggestionContext({
      workspaceContext,
      agent: {
        name: "Agent",
        systemPrompt: "Help users",
        enabledMcpServerIds: ["mcp-1"],
        enabledSkillIds: ["posthog-analytics"],
      },
    });
    expect(context.agent.hasEnabledTools).toBe(true);
    expect(context.agent.enabledSkillIds).toEqual(["posthog-analytics"]);
  });
});
