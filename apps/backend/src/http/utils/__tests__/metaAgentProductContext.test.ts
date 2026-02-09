import { describe, expect, it } from "vitest";

import { getMetaAgentSystemPrompt } from "../agentConfigTools";
import {
  HELPMATON_BYOK_RULE,
  HELPMATON_PRODUCT_DESCRIPTION,
  HELPMATON_SUBSCRIPTION_TIERS,
} from "../metaAgentProductContext";
import { getOnboardingAgentSystemPrompt } from "../onboardingAgentLlm";
import { createWorkspaceAgentDescriptor } from "../workspaceAgentTools";

describe("metaAgentProductContext", () => {
  it("exports product description containing Helpmaton and workspace", () => {
    expect(HELPMATON_PRODUCT_DESCRIPTION).toContain("Helpmaton");
    expect(HELPMATON_PRODUCT_DESCRIPTION).toContain("workspace");
    expect(HELPMATON_PRODUCT_DESCRIPTION).toContain("credits");
    expect(HELPMATON_PRODUCT_DESCRIPTION).toContain("webhooks");
  });

  it("exports subscription tiers mentioning Free, Starter, Pro", () => {
    expect(HELPMATON_SUBSCRIPTION_TIERS).toContain("Free");
    expect(HELPMATON_SUBSCRIPTION_TIERS).toContain("Starter");
    expect(HELPMATON_SUBSCRIPTION_TIERS).toContain("Pro");
  });

  it("exports BYOK rule stating not to claim more models", () => {
    expect(HELPMATON_BYOK_RULE).toContain("BYOK");
    expect(HELPMATON_BYOK_RULE).toMatch(/more model/i);
  });
});

describe("onboarding agent system prompt", () => {
  it("contains BYOK rule and product description", () => {
    const prompt = getOnboardingAgentSystemPrompt({});
    expect(prompt).toContain("BYOK");
    expect(prompt).toContain("Helpmaton");
    expect(prompt).toContain("workspace");
  });

  it("contains accurate web search schema (searchWebProvider, fetchWebProvider, enableExaSearch)", () => {
    const prompt = getOnboardingAgentSystemPrompt({});
    expect(prompt).toContain("searchWebProvider");
    expect(prompt).toContain("fetchWebProvider");
    expect(prompt).toContain("enableExaSearch");
  });

  it("includes subscription limits section when subscriptionContext is provided", () => {
    const prompt = getOnboardingAgentSystemPrompt({
      subscriptionContext: {
        plan: "starter",
        limits: {
          maxWorkspaces: 2,
          maxAgents: 5,
          maxChannels: 3,
          maxMcpServers: 2,
          maxEvalJudgesPerAgent: 2,
          maxAgentSchedulesPerAgent: 3,
        },
        usage: {
          workspaces: 1,
          agents: 2,
          channels: 0,
          mcpServers: 1,
        },
      },
    });
    expect(prompt).toContain("Subscription limits");
    expect(prompt).toContain("starter");
  });
});

describe("workspace agent system prompt", () => {
  it("contains product description and reserved agent ID guidance", () => {
    const descriptor = createWorkspaceAgentDescriptor("ws-123");
    const prompt = descriptor.systemPrompt;
    expect(prompt).toContain("Helpmaton");
    expect(prompt).toContain("_workspace");
    expect(prompt).toContain("list_agents");
    expect(prompt).toContain("get_workspace");
  });

  it("contains credits vs spending limits and tool list", () => {
    const descriptor = createWorkspaceAgentDescriptor("ws-456");
    const prompt = descriptor.systemPrompt;
    expect(prompt).toContain("Credits are");
    expect(prompt).toContain("spending limits");
    expect(prompt).toContain("configure_agent");
    expect(prompt).toMatch(/1=READ|2=WRITE|3=OWNER/);
  });

  it("includes internal documentation section and read_internal_doc index", () => {
    const descriptor = createWorkspaceAgentDescriptor("ws-789");
    const prompt = descriptor.systemPrompt;
    expect(prompt).toContain("Internal documentation (customer support)");
    expect(prompt).toContain("read_internal_doc");
    expect(prompt).toContain("3 read attempts");
    expect(prompt).toMatch(/- \[[\w-]+\] .+ [—-] .+/);
  });
});

describe("agent-config meta-agent system prompt", () => {
  it("contains get_my_config and configuration assistant role", () => {
    const prompt = getMetaAgentSystemPrompt("MyAgent");
    expect(prompt).toContain("get_my_config");
    expect(prompt).toContain("configuration assistant");
    expect(prompt).toContain("MyAgent");
  });

  it("contains configuration areas (schedules, eval judges) and limit rule", () => {
    const prompt = getMetaAgentSystemPrompt("Test");
    expect(prompt).toContain("create_my_schedule");
    expect(prompt).toContain("eval judge");
    expect(prompt).toMatch(/subscription caps|limits per agent/i);
  });

  it("includes internal documentation section and read_internal_doc index", () => {
    const prompt = getMetaAgentSystemPrompt("ConfigAgent");
    expect(prompt).toContain("Internal documentation (customer support)");
    expect(prompt).toContain("read_internal_doc");
    expect(prompt).toContain("3 read attempts");
    expect(prompt).toMatch(/- \[[\w-]+\] .+ [—-] .+/);
  });
});
