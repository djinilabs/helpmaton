import { describe, it, expect, vi, beforeEach } from "vitest";

import { AGENT_CREATED_EVENT, createAgentRecord } from "../agentCreate";

const { mockTrackEvent } = vi.hoisted(() => ({ mockTrackEvent: vi.fn() }));

vi.mock("../tracking", () => ({
  trackEvent: mockTrackEvent,
}));

describe("agentCreate", () => {
  const mockAgentCreate = vi.fn();

  const mockDb = {
    agent: {
      create: mockAgentCreate,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createAgentRecord", () => {
    it("calls db.agent.create with required params only", async () => {
      const created = {
        pk: "agents/ws-1/agent-1",
        sk: "agent",
        workspaceId: "ws-1",
        name: "Test Agent",
        systemPrompt: "You are helpful.",
        provider: "openrouter",
        version: 1,
        createdAt: "2024-01-01T00:00:00Z",
      };
      mockAgentCreate.mockResolvedValue(created);

      const result = await createAgentRecord(mockDb as never, {
        pk: "agents/ws-1/agent-1",
        sk: "agent",
        workspaceId: "ws-1",
        name: "Test Agent",
        systemPrompt: "You are helpful.",
        provider: "openrouter",
      });

      expect(mockAgentCreate).toHaveBeenCalledTimes(1);
      expect(mockAgentCreate).toHaveBeenCalledWith({
        pk: "agents/ws-1/agent-1",
        sk: "agent",
        workspaceId: "ws-1",
        name: "Test Agent",
        systemPrompt: "You are helpful.",
        provider: "openrouter",
      });
      expect(result).toEqual(created);
    });

    it("passes through optional params to db.agent.create", async () => {
      mockAgentCreate.mockResolvedValue({});

      await createAgentRecord(mockDb as never, {
        pk: "agents/ws-2/agent-2",
        sk: "agent",
        workspaceId: "ws-2",
        name: "Full Agent",
        systemPrompt: "You are an assistant.",
        provider: "openrouter",
        modelName: "openai/gpt-4o",
        createdBy: "users/u1",
        avatar: "/images/helpmaton_logo_10.svg",
        memoryExtractionEnabled: true,
      });

      expect(mockAgentCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          pk: "agents/ws-2/agent-2",
          sk: "agent",
          workspaceId: "ws-2",
          name: "Full Agent",
          systemPrompt: "You are an assistant.",
          provider: "openrouter",
          modelName: "openai/gpt-4o",
          createdBy: "users/u1",
          avatar: "/images/helpmaton_logo_10.svg",
          memoryExtractionEnabled: true,
        }),
      );
    });

    it("sends agent_created PostHog event with workspace_id, agent_id, user_id, provider, model_name", async () => {
      const created = {
        pk: "agents/ws-3/agent-3",
        sk: "agent",
        workspaceId: "ws-3",
        name: "Tracked Agent",
        systemPrompt: "You help.",
        provider: "openrouter",
        modelName: "openai/gpt-4o-mini",
        version: 1,
        createdAt: "2024-01-01T00:00:00Z",
      };
      mockAgentCreate.mockResolvedValue(created);

      await createAgentRecord(mockDb as never, {
        pk: "agents/ws-3/agent-3",
        sk: "agent",
        workspaceId: "ws-3",
        name: "Tracked Agent",
        systemPrompt: "You help.",
        provider: "openrouter",
        createdBy: "users/creator-99",
      });

      expect(mockTrackEvent).toHaveBeenCalledTimes(1);
      expect(mockTrackEvent).toHaveBeenCalledWith(
        AGENT_CREATED_EVENT,
        expect.objectContaining({
          workspace_id: "ws-3",
          agent_id: "agent-3",
          user_id: "creator-99",
          provider: "openrouter",
          model_name: "openai/gpt-4o-mini",
        }),
      );
    });

    it("sends event with user_id undefined when createdBy not in params", async () => {
      mockAgentCreate.mockResolvedValue({
        pk: "agents/ws-5/agent-5",
        sk: "agent",
        workspaceId: "ws-5",
        name: "No Creator",
        systemPrompt: "Help.",
        provider: "openrouter",
        version: 1,
        createdAt: "2024-01-01T00:00:00Z",
      });

      await createAgentRecord(mockDb as never, {
        pk: "agents/ws-5/agent-5",
        sk: "agent",
        workspaceId: "ws-5",
        name: "No Creator",
        systemPrompt: "Help.",
        provider: "openrouter",
      });

      expect(mockTrackEvent).toHaveBeenCalledWith(
        AGENT_CREATED_EVENT,
        expect.objectContaining({
          workspace_id: "ws-5",
          agent_id: "agent-5",
          user_id: undefined,
        })
      );
    });

    it("does not send event when pk has no agentId segment (malformed)", async () => {
      mockAgentCreate.mockResolvedValue({
        pk: "agents/ws-only",
        sk: "agent",
        workspaceId: "ws-only",
        name: "Agent",
        systemPrompt: "Help.",
        provider: "openrouter",
        version: 1,
        createdAt: "2024-01-01T00:00:00Z",
      });

      const result = await createAgentRecord(mockDb as never, {
        pk: "agents/ws-only",
        sk: "agent",
        workspaceId: "ws-only",
        name: "Agent",
        systemPrompt: "Help.",
        provider: "openrouter",
      });

      expect(mockTrackEvent).not.toHaveBeenCalled();
      expect(result.pk).toBe("agents/ws-only");
    });

    it("does not throw when trackEvent throws and still returns created record", async () => {
      const created = {
        pk: "agents/ws-4/agent-4",
        sk: "agent",
        workspaceId: "ws-4",
        name: "Agent",
        systemPrompt: "Help.",
        provider: "openrouter",
        version: 1,
        createdAt: "2024-01-01T00:00:00Z",
      };
      mockAgentCreate.mockResolvedValue(created);
      mockTrackEvent.mockImplementation(() => {
        throw new Error("PostHog unavailable");
      });

      const result = await createAgentRecord(mockDb as never, {
        pk: "agents/ws-4/agent-4",
        sk: "agent",
        workspaceId: "ws-4",
        name: "Agent",
        systemPrompt: "Help.",
        provider: "openrouter",
      });

      expect(result).toEqual(created);
      expect(result.pk).toBe("agents/ws-4/agent-4");
      expect(result.name).toBe("Agent");
    });
  });
});
