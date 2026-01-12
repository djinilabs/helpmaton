import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("AgentWidget.init", () => {
  beforeEach(() => {
    // Clear any existing widget instances
    document.body.innerHTML = "";
    // Note: customElements.undefine is not a standard API and not available in jsdom
    // We rely on dynamic imports to get fresh module instances
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("should throw error when required options are missing", () => {
    // Dynamic import to ensure fresh module
    return import("../index").then((module) => {
      expect(() => {
        module.init({} as any);
      }).toThrow("AgentWidget.init requires apiKey, workspaceId, and agentId");
    });
  });

  it("should throw error when apiKey is missing", () => {
    return import("../index").then((module) => {
      expect(() => {
        module.init({
          workspaceId: "workspace-123",
          agentId: "agent-456",
        } as any);
      }).toThrow("AgentWidget.init requires apiKey, workspaceId, and agentId");
    });
  });

  it("should throw error when workspaceId is missing", () => {
    return import("../index").then((module) => {
      expect(() => {
        module.init({
          apiKey: "key-123",
          agentId: "agent-456",
        } as any);
      }).toThrow("AgentWidget.init requires apiKey, workspaceId, and agentId");
    });
  });

  it("should throw error when agentId is missing", () => {
    return import("../index").then((module) => {
      expect(() => {
        module.init({
          apiKey: "key-123",
          workspaceId: "workspace-123",
        } as any);
      }).toThrow("AgentWidget.init requires apiKey, workspaceId, and agentId");
    });
  });

  it("should create widget element with valid options", async () => {
    // Register the custom element first
    await import("../AgentChatWidget");
    
    // Wait for custom element to be defined
    await customElements.whenDefined("agent-chat-widget");

    const { init } = await import("../index");

    init({
      apiKey: "key-123",
      workspaceId: "workspace-123",
      agentId: "agent-456",
    });

    const widgetElement = document.querySelector("agent-chat-widget");
    expect(widgetElement).toBeTruthy();
    expect(widgetElement?.getAttribute("data-base-url")).toBeNull();
  });

  it("should set baseUrl attribute when provided", async () => {
    await import("../AgentChatWidget");
    await customElements.whenDefined("agent-chat-widget");

    const { init } = await import("../index");

    init({
      apiKey: "key-123",
      workspaceId: "workspace-123",
      agentId: "agent-456",
      baseUrl: "https://custom.example.com",
    });

    const widgetElement = document.querySelector("agent-chat-widget");
    expect(widgetElement?.getAttribute("data-base-url")).toBe(
      "https://custom.example.com"
    );
  });

  it("should remove existing widget before creating new one", async () => {
    await import("../AgentChatWidget");
    await customElements.whenDefined("agent-chat-widget");

    const { init } = await import("../index");

    // Create first widget
    init({
      apiKey: "key-123",
      workspaceId: "workspace-123",
      agentId: "agent-456",
    });

    const firstWidget = document.querySelector("agent-chat-widget");
    expect(firstWidget).toBeTruthy();

    // Create second widget
    init({
      apiKey: "key-456",
      workspaceId: "workspace-789",
      agentId: "agent-012",
    });

    const widgets = document.querySelectorAll("agent-chat-widget");
    expect(widgets.length).toBe(1);
    expect(widgets[0]).not.toBe(firstWidget);
  });

  it("should export init function globally on window", async () => {
    await import("../index");

    expect((window as any).AgentWidget).toBeDefined();
    expect(typeof (window as any).AgentWidget.init).toBe("function");
  });
});
