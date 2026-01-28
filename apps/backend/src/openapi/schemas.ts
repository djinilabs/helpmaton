/**
 * Reusable JSON schemas for OpenAPI specification
 */

export const openApiSchemas = {
  Error: {
    type: "object",
    required: ["statusCode", "error"],
    properties: {
      statusCode: {
        type: "integer",
        description: "HTTP status code",
      },
      error: {
        type: "string",
        description: "Error type",
      },
      message: {
        type: "string",
        description: "Error message",
      },
    },
  },
  Workspace: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Workspace ID",
      },
      name: {
        type: "string",
        description: "Workspace name",
      },
      description: {
        type: "string",
        description: "Workspace description",
        nullable: true,
      },
      permissionLevel: {
        type: "integer",
        description: "User's permission level in this workspace",
        nullable: true,
      },
      creditBalance: {
        type: "integer",
        description: "Current credit balance in nano-dollars",
      },
      currency: {
        type: "string",
        enum: ["usd"],
        description: "Currency code",
      },
      spendingLimits: {
        type: "array",
        items: {
          $ref: "#/components/schemas/SpendingLimit",
        },
        description: "Spending limits configuration",
      },
      createdAt: {
        type: "string",
        format: "date-time",
        description: "Creation timestamp",
      },
    },
  },
  WorkspacesResponse: {
    type: "object",
    properties: {
      workspaces: {
        type: "array",
        items: {
          $ref: "#/components/schemas/Workspace",
        },
      },
    },
  },
  WorkspaceResponse: {
    type: "object",
    allOf: [
      {
        $ref: "#/components/schemas/Workspace",
      },
    ],
  },
  CreateWorkspaceRequest: {
    type: "object",
    required: ["name"],
    properties: {
      name: {
        type: "string",
        description: "Workspace name",
      },
      description: {
        type: "string",
        description: "Workspace description",
      },
      currency: {
        type: "string",
        enum: ["usd"],
        description: "Currency code",
        default: "usd",
      },
    },
  },
  UpdateWorkspaceRequest: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Workspace name",
      },
      description: {
        type: "string",
        description: "Workspace description",
      },
    },
  },
  Agent: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Agent ID",
      },
      name: {
        type: "string",
        description: "Agent name",
      },
      systemPrompt: {
        type: "string",
        description: "System prompt for the agent",
      },
      workspaceId: {
        type: "string",
        description: "Workspace ID",
      },
      clientTools: {
        type: "array",
        items: {
          $ref: "#/components/schemas/ClientTool",
        },
        description: "Client-side tools",
      },
      notificationChannelId: {
        type: "string",
        description: "Notification channel ID",
        nullable: true,
      },
      delegatableAgentIds: {
        type: "array",
        items: {
          type: "string",
        },
        description: "IDs of agents that can be delegated to",
      },
      enabledMcpServerIds: {
        type: "array",
        items: {
          type: "string",
        },
        description: "IDs of enabled MCP servers",
      },
      enableMemorySearch: {
        type: "boolean",
        description: "Enable the memory search tool for this agent",
      },
      enableSearchDocuments: {
        type: "boolean",
        description: "Enable the document search tool for this agent",
      },
      enableSendEmail: {
        type: "boolean",
        description:
          "Enable the email sending tool for this agent (requires workspace email connection)",
      },
      enableImageGeneration: {
        type: "boolean",
        description: "Enable the image generation tool for this agent",
      },
      imageGenerationModel: {
        type: "string",
        description: "Image generation model name from OpenRouter",
        nullable: true,
      },
      memoryExtractionEnabled: {
        type: "boolean",
        description: "Enable memory extraction for this agent",
      },
      memoryExtractionModel: {
        type: "string",
        description: "Model name to use for memory extraction",
        nullable: true,
      },
      memoryExtractionPrompt: {
        type: "string",
        description: "Prompt to use for memory extraction",
        nullable: true,
      },
      summarizationPrompts: {
        $ref: "#/components/schemas/SummarizationPrompts",
      },
      createdAt: {
        type: "string",
        format: "date-time",
        description: "Creation timestamp",
      },
    },
  },
  ClientTool: {
    type: "object",
    required: ["name", "description", "parameters"],
    properties: {
      name: {
        type: "string",
        description: "Tool name (must be valid JavaScript identifier)",
      },
      description: {
        type: "string",
        description: "Tool description",
      },
      parameters: {
        type: "object",
        description: "JSON Schema for tool parameters",
        additionalProperties: true,
      },
    },
  },
  SummarizationPrompts: {
    type: "object",
    description: "Optional summarization prompt overrides per temporal grain",
    properties: {
      daily: {
        type: "string",
        description: "Override prompt for daily summaries",
        nullable: true,
      },
      weekly: {
        type: "string",
        description: "Override prompt for weekly summaries",
        nullable: true,
      },
      monthly: {
        type: "string",
        description: "Override prompt for monthly summaries",
        nullable: true,
      },
      quarterly: {
        type: "string",
        description: "Override prompt for quarterly summaries",
        nullable: true,
      },
      yearly: {
        type: "string",
        description: "Override prompt for yearly summaries",
        nullable: true,
      },
    },
  },
  AgentsResponse: {
    type: "object",
    properties: {
      agents: {
        type: "array",
        items: {
          $ref: "#/components/schemas/Agent",
        },
      },
    },
  },
  AgentResponse: {
    type: "object",
    allOf: [
      {
        $ref: "#/components/schemas/Agent",
      },
    ],
  },
  CreateAgentRequest: {
    type: "object",
    required: ["name", "systemPrompt"],
    properties: {
      name: {
        type: "string",
        description: "Agent name",
      },
      systemPrompt: {
        type: "string",
        description: "System prompt for the agent",
      },
      clientTools: {
        type: "array",
        items: {
          $ref: "#/components/schemas/ClientTool",
        },
        description: "Client-side tools",
      },
      notificationChannelId: {
        type: "string",
        description: "Notification channel ID",
      },
      delegatableAgentIds: {
        type: "array",
        items: {
          type: "string",
        },
        description: "IDs of agents that can be delegated to",
      },
      enabledMcpServerIds: {
        type: "array",
        items: {
          type: "string",
        },
        description: "IDs of enabled MCP servers",
      },
      enableMemorySearch: {
        type: "boolean",
        description: "Enable the memory search tool for this agent",
      },
      enableSearchDocuments: {
        type: "boolean",
        description: "Enable the document search tool for this agent",
      },
      enableSendEmail: {
        type: "boolean",
        description:
          "Enable the email sending tool for this agent (requires workspace email connection)",
      },
      enableImageGeneration: {
        type: "boolean",
        description: "Enable the image generation tool for this agent",
      },
      imageGenerationModel: {
        type: "string",
        description: "Image generation model name from OpenRouter",
        nullable: true,
      },
      summarizationPrompts: {
        $ref: "#/components/schemas/SummarizationPrompts",
      },
      memoryExtractionEnabled: {
        type: "boolean",
        description: "Enable memory extraction for this agent",
      },
      memoryExtractionModel: {
        type: "string",
        description: "Model name to use for memory extraction",
        nullable: true,
      },
      memoryExtractionPrompt: {
        type: "string",
        description: "Prompt to use for memory extraction",
        nullable: true,
      },
    },
  },
  UpdateAgentRequest: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Agent name",
      },
      systemPrompt: {
        type: "string",
        description: "System prompt for the agent",
      },
      clientTools: {
        type: "array",
        items: {
          $ref: "#/components/schemas/ClientTool",
        },
        description: "Client-side tools",
      },
      notificationChannelId: {
        type: "string",
        description: "Notification channel ID",
        nullable: true,
      },
      delegatableAgentIds: {
        type: "array",
        items: {
          type: "string",
        },
        description: "IDs of agents that can be delegated to",
      },
      enabledMcpServerIds: {
        type: "array",
        items: {
          type: "string",
        },
        description: "IDs of enabled MCP servers",
      },
      enableMemorySearch: {
        type: "boolean",
        description: "Enable the memory search tool for this agent",
      },
      enableSearchDocuments: {
        type: "boolean",
        description: "Enable the document search tool for this agent",
      },
      enableSendEmail: {
        type: "boolean",
        description:
          "Enable the email sending tool for this agent (requires workspace email connection)",
      },
      enableImageGeneration: {
        type: "boolean",
        description: "Enable the image generation tool for this agent",
      },
      imageGenerationModel: {
        type: "string",
        description: "Image generation model name from OpenRouter",
        nullable: true,
      },
      summarizationPrompts: {
        $ref: "#/components/schemas/SummarizationPrompts",
      },
      memoryExtractionEnabled: {
        type: "boolean",
        description: "Enable memory extraction for this agent",
      },
      memoryExtractionModel: {
        type: "string",
        description: "Model name to use for memory extraction",
        nullable: true,
      },
      memoryExtractionPrompt: {
        type: "string",
        description: "Prompt to use for memory extraction",
        nullable: true,
      },
    },
  },
  SpendingLimit: {
    type: "object",
    properties: {
      amount: {
        type: "integer",
        description: "Limit amount in nano-dollars",
      },
      currency: {
        type: "string",
        enum: ["usd"],
        description: "Currency code",
      },
      period: {
        type: "string",
        enum: ["daily", "weekly", "monthly"],
        description: "Time period",
      },
    },
  },
  UsageResponse: {
    type: "object",
    properties: {
      userId: {
        type: "string",
        description: "User ID",
      },
      currency: {
        type: "string",
        enum: ["usd"],
        description: "Currency code",
      },
      startDate: {
        type: "string",
        format: "date",
        description: "Start date (YYYY-MM-DD)",
      },
      endDate: {
        type: "string",
        format: "date",
        description: "End date (YYYY-MM-DD)",
      },
      workspaceCount: {
        type: "integer",
        description: "Number of workspaces",
      },
      stats: {
        type: "object",
        properties: {
          inputTokens: {
            type: "integer",
            description: "Total input tokens",
          },
          outputTokens: {
            type: "integer",
            description: "Total output tokens",
          },
          totalTokens: {
            type: "integer",
            description: "Total tokens",
          },
          cost: {
            type: "integer",
            description: "Total cost in specified currency (nano-dollars)",
          },
          rerankingCostUsd: {
            type: "integer",
            description: "Reranking costs in USD (nano-dollars)",
          },
          evalCostUsd: {
            type: "integer",
            description: "Eval judge costs in USD (nano-dollars)",
          },
          byModel: {
            type: "array",
            items: {
              type: "object",
              properties: {
                model: {
                  type: "string",
                },
                inputTokens: {
                  type: "integer",
                },
                outputTokens: {
                  type: "integer",
                },
                totalTokens: {
                  type: "integer",
                },
                cost: {
                  type: "number",
                },
              },
            },
          },
          byProvider: {
            type: "array",
            items: {
              type: "object",
              properties: {
                provider: {
                  type: "string",
                },
                inputTokens: {
                  type: "integer",
                },
                outputTokens: {
                  type: "integer",
                },
                totalTokens: {
                  type: "integer",
                },
                cost: {
                  type: "number",
                },
              },
            },
          },
          byByok: {
            type: "object",
            properties: {
              byok: {
                type: "object",
                properties: {
                  inputTokens: {
                    type: "integer",
                  },
                  outputTokens: {
                    type: "integer",
                  },
                  totalTokens: {
                    type: "integer",
                  },
                  cost: {
                    type: "number",
                  },
                },
              },
              platform: {
                type: "object",
                properties: {
                  inputTokens: {
                    type: "integer",
                  },
                  outputTokens: {
                    type: "integer",
                  },
                  totalTokens: {
                    type: "integer",
                  },
                  cost: {
                    type: "number",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  ModelsResponse: {
    type: "object",
    additionalProperties: {
      type: "object",
      properties: {
        models: {
          type: "array",
          items: {
            type: "string",
          },
        },
        defaultModel: {
          type: "string",
        },
        imageModels: {
          type: "array",
          items: {
            type: "string",
          },
        },
        capabilities: {
          type: "object",
          additionalProperties: {
            $ref: "#/components/schemas/ModelCapabilities",
          },
        },
      },
    },
  },
  ModelCapabilities: {
    type: "object",
    properties: {
      input_modalities: {
        type: "array",
        items: {
          type: "string",
        },
      },
      output_modalities: {
        type: "array",
        items: {
          type: "string",
        },
      },
      supported_parameters: {
        type: "array",
        items: {
          type: "string",
        },
      },
      text_generation: {
        type: "boolean",
      },
      image_generation: {
        type: "boolean",
      },
      rerank: {
        type: "boolean",
      },
      tool_calling: {
        type: "boolean",
      },
      structured_output: {
        type: "boolean",
      },
      image: {
        type: "boolean",
      },
    },
  },
  GeneratePromptRequest: {
    type: "object",
    required: ["goal"],
    properties: {
      goal: {
        type: "string",
        description: "Goal description for the agent",
      },
      agentId: {
        type: "string",
        description: "Optional agent ID for editing existing agent",
      },
    },
  },
  GeneratePromptResponse: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Generated system prompt",
      },
    },
  },
};
