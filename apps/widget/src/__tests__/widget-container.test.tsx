import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock AgentChat component
vi.mock("@/components/AgentChat", () => ({
  AgentChat: ({ workspaceId, agentId, api, tools, enableFileUpload }: any) => (
    <div data-testid="agent-chat">
      <div>Workspace: {workspaceId}</div>
      <div>Agent: {agentId}</div>
      <div>API: {api}</div>
      <div>Tools: {tools ? Object.keys(tools).join(", ") : "none"}</div>
      <div>
        Uploads: {enableFileUpload === false ? "disabled" : "enabled"}
      </div>
    </div>
  ),
}));

describe("WidgetContainer", () => {
  it("should render AgentChat with correct props", async () => {
    const { WidgetContainer } = await import("../widget-container");

    const config = {
      apiKey: "key-123",
      workspaceId: "workspace-123",
      agentId: "agent-456",
    };

    render(<WidgetContainer config={config} baseUrl="https://api.example.com" />);

    expect(screen.getByTestId("agent-chat")).toBeInTheDocument();
    expect(screen.getByText("Workspace: workspace-123")).toBeInTheDocument();
    expect(screen.getByText("Agent: agent-456")).toBeInTheDocument();
    expect(
      screen.getByText(
        "API: https://api.example.com/api/widget/workspace-123/agent-456/key-123"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Uploads: enabled")).toBeInTheDocument();
  });

  it("should pass tools to AgentChat when provided", async () => {
    const { WidgetContainer } = await import("../widget-container");

    const mockTool = vi.fn().mockResolvedValue("result");

    const config = {
      apiKey: "key-123",
      workspaceId: "workspace-123",
      agentId: "agent-456",
      tools: {
        testTool: mockTool,
      },
    };

    render(<WidgetContainer config={config} baseUrl="https://api.example.com" />);

    expect(screen.getByText("Tools: testTool")).toBeInTheDocument();
    expect(screen.getByText("Uploads: enabled")).toBeInTheDocument();
  });

  it("should apply font customization variables when provided", async () => {
    const { WidgetContainer } = await import("../widget-container");

    const config = {
      apiKey: "key-123",
      workspaceId: "workspace-123",
      agentId: "agent-456",
      fontFamily: "Inter, sans-serif",
      fontSize: "15px",
    };

    const { container } = render(
      <WidgetContainer config={config} baseUrl="https://api.example.com" />
    );

    const wrapper = container.firstChild as HTMLElement | null;
    expect(wrapper?.style.getPropertyValue("--widget-font-family")).toBe(
      "Inter, sans-serif"
    );
    expect(wrapper?.style.getPropertyValue("--widget-font-size")).toBe("15px");
  });

  it("should handle missing tools", async () => {
    const { WidgetContainer } = await import("../widget-container");

    const config = {
      apiKey: "key-123",
      workspaceId: "workspace-123",
      agentId: "agent-456",
    };

    render(<WidgetContainer config={config} baseUrl="https://api.example.com" />);

    expect(screen.getByText("Tools: none")).toBeInTheDocument();
    expect(screen.getByText("Uploads: enabled")).toBeInTheDocument();
  });

  it("should disable uploads when configured", async () => {
    const { WidgetContainer } = await import("../widget-container");

    const config = {
      apiKey: "key-123",
      workspaceId: "workspace-123",
      agentId: "agent-456",
      enableFileUpload: false,
    };

    render(<WidgetContainer config={config} baseUrl="https://api.example.com" />);

    expect(screen.getByText("Uploads: disabled")).toBeInTheDocument();
  });
});
