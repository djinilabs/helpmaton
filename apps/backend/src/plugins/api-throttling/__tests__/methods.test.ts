import { describe, expect, it } from "vitest";

const createResource = (pathPart: string, parentId: string) => ({
  Type: "AWS::ApiGateway::Resource",
  Properties: {
    PathPart: pathPart,
    ParentId: parentId,
  },
});

const createMethod = (resourceId: string) => ({
  Type: "AWS::ApiGateway::Method",
  Properties: {
    ResourceId: { Ref: resourceId },
  },
});

describe("configureMethodAuthorizers", () => {
  it("skips OAuth callback routes for email and MCP", async () => {
    const { configureMethodAuthorizers } = await import("../methods");
    const resources = {
      ApiResource: createResource("api", "RootResource"),
      HealthResource: createResource("health", "ApiResource"),
      EmailResource: createResource("email", "ApiResource"),
      EmailOauthResource: createResource("oauth", "EmailResource"),
      EmailOauthCallbackResource: createResource(
        "callback",
        "EmailOauthResource"
      ),
      McpResource: createResource("mcp", "ApiResource"),
      McpOauthResource: createResource("oauth", "McpResource"),
      McpOauthCallbackResource: createResource("callback", "McpOauthResource"),
      DiscordResource: createResource("discord", "ApiResource"),
      WorkspacesResource: createResource("workspaces", "ApiResource"),
      EmailOauthMethod: createMethod("EmailOauthCallbackResource"),
      McpOauthMethod: createMethod("McpOauthCallbackResource"),
      DiscordMethod: createMethod("DiscordResource"),
      HealthMethod: createMethod("HealthResource"),
      WorkspacesMethod: createMethod("WorkspacesResource"),
    };

    const updated = configureMethodAuthorizers(
      { Resources: { ...resources } },
      "ApiAuthorizer"
    );

    const emailMethod = updated.Resources.EmailOauthMethod
      .Properties as {
      AuthorizationType?: string;
      AuthorizerId?: unknown;
    };
    const mcpMethod = updated.Resources.McpOauthMethod
      .Properties as {
      AuthorizationType?: string;
      AuthorizerId?: unknown;
    };
    const discordMethod = updated.Resources.DiscordMethod
      .Properties as {
      AuthorizationType?: string;
      AuthorizerId?: unknown;
    };
    const healthMethod = updated.Resources.HealthMethod
      .Properties as {
      AuthorizationType?: string;
      AuthorizerId?: unknown;
    };
    const workspacesMethod = updated.Resources.WorkspacesMethod
      .Properties as {
      AuthorizationType?: string;
      AuthorizerId?: unknown;
    };

    expect(emailMethod.AuthorizationType).toBeUndefined();
    expect(emailMethod.AuthorizerId).toBeUndefined();
    expect(mcpMethod.AuthorizationType).toBeUndefined();
    expect(mcpMethod.AuthorizerId).toBeUndefined();
    expect(discordMethod.AuthorizationType).toBeUndefined();
    expect(discordMethod.AuthorizerId).toBeUndefined();
    expect(healthMethod.AuthorizationType).toBeUndefined();
    expect(healthMethod.AuthorizerId).toBeUndefined();

    expect(workspacesMethod.AuthorizationType).toBe("CUSTOM");
    expect(workspacesMethod.AuthorizerId).toEqual({
      Ref: "ApiAuthorizer",
    });
  });
});
