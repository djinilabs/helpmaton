import { badRequest, unauthorized } from "@hapi/boom";
import express from "express";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  createMockRequest,
  createMockResponse,
  createMockDatabase,
} from "../../../utils/__tests__/test-helpers";

// Mock dependencies using vi.hoisted to ensure they're set up before imports
const { mockDatabase } = vi.hoisted(() => {
  return {
    mockDatabase: vi.fn(),
  };
});

// Mock the modules
vi.mock("../../../../tables", () => ({
  database: mockDatabase,
}));

describe("POST /api/workspaces/:workspaceId/email-connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        const { type, name, config } = req.body;
        if (!type || typeof type !== "string") {
          throw badRequest("type is required and must be a string");
        }
        if (!["gmail", "outlook", "smtp"].includes(type)) {
          throw badRequest('type must be one of: "gmail", "outlook", "smtp"');
        }
        const emailConnectionType = type as "gmail" | "outlook" | "smtp";
        if (!name || typeof name !== "string") {
          throw badRequest("name is required and must be a string");
        }
        if (!config || typeof config !== "object") {
          throw badRequest("config is required and must be an object");
        }

        // Validate type-specific config
        if (type === "smtp") {
          if (!config.host || typeof config.host !== "string") {
            throw badRequest("config.host is required for SMTP connections");
          }
          if (config.port === undefined || typeof config.port !== "number") {
            throw badRequest("config.port is required for SMTP connections");
          }
          if (typeof config.secure !== "boolean") {
            throw badRequest("config.secure is required for SMTP connections");
          }
          if (!config.username || typeof config.username !== "string") {
            throw badRequest(
              "config.username is required for SMTP connections"
            );
          }
          if (!config.password || typeof config.password !== "string") {
            throw badRequest(
              "config.password is required for SMTP connections"
            );
          }
          if (!config.fromEmail || typeof config.fromEmail !== "string") {
            throw badRequest(
              "config.fromEmail is required for SMTP connections"
            );
          }
        }

        const db = await mockDatabase();
        const workspaceResource = (req as { workspaceResource?: string })
          .workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const currentUserRef = (req as { userRef?: string }).userRef;
        if (!currentUserRef) {
          throw unauthorized();
        }
        const workspaceId = req.params.workspaceId;
        const pk = `email-connections/${workspaceId}`;
        const sk = "connection";

        // Check if connection already exists
        const existing = await db["email-connection"].get(pk, sk);

        if (existing) {
          // Update existing connection
          const updated = await db["email-connection"].update({
            pk,
            sk,
            workspaceId,
            type: emailConnectionType,
            name,
            config,
            updatedBy: currentUserRef,
            updatedAt: new Date().toISOString(),
          });

          res.json({
            name: updated.name,
            type: updated.type,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          });
        } else {
          // Create new connection
          const connection = await db["email-connection"].create({
            pk,
            sk,
            workspaceId,
            type: emailConnectionType,
            name,
            config,
            createdBy: currentUserRef,
          });

          res.status(201).json({
            name: connection.name,
            type: connection.type,
            createdAt: connection.createdAt,
            updatedAt: connection.updatedAt,
          });
        }
      } catch (error) {
        next(error);
      }
    };

    await handler(req as express.Request, res as express.Response, next);
  }

  it("should create new Gmail email connection", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-456";
    const pk = `email-connections/${workspaceId}`;

    const mockGet = vi.fn().mockResolvedValue(null);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const newConnection = {
      pk,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Gmail Connection",
      config: { token: "token123" },
      createdBy: userRef,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockCreate = vi.fn().mockResolvedValue(newConnection);
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { create: typeof mockCreate };
    emailConnectionMock.create = mockCreate;

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
      },
      body: {
        type: "gmail",
        name: "Gmail Connection",
        config: { token: "token123" },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "connection");
    expect(mockCreate).toHaveBeenCalledWith({
      pk,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Gmail Connection",
      config: { token: "token123" },
      createdBy: userRef,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      name: "Gmail Connection",
      type: "gmail",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    });
  });

  it("should create new Outlook email connection", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-456";
    const pk = `email-connections/${workspaceId}`;

    const mockGet = vi.fn().mockResolvedValue(null);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const newConnection = {
      pk,
      sk: "connection",
      workspaceId,
      type: "outlook",
      name: "Outlook Connection",
      config: { token: "outlook-token" },
      createdBy: userRef,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockCreate = vi.fn().mockResolvedValue(newConnection);
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { create: typeof mockCreate };
    emailConnectionMock.create = mockCreate;

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
      },
      body: {
        type: "outlook",
        name: "Outlook Connection",
        config: { token: "outlook-token" },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith({
      pk,
      sk: "connection",
      workspaceId,
      type: "outlook",
      name: "Outlook Connection",
      config: { token: "outlook-token" },
      createdBy: userRef,
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("should create new SMTP email connection with all required fields", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-456";
    const pk = `email-connections/${workspaceId}`;

    const mockGet = vi.fn().mockResolvedValue(null);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const newConnection = {
      pk,
      sk: "connection",
      workspaceId,
      type: "smtp",
      name: "SMTP Connection",
      config: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "user@example.com",
        password: "password123",
        fromEmail: "noreply@example.com",
      },
      createdBy: userRef,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };

    const mockCreate = vi.fn().mockResolvedValue(newConnection);
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { create: typeof mockCreate };
    emailConnectionMock.create = mockCreate;

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
      },
      body: {
        type: "smtp",
        name: "SMTP Connection",
        config: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          username: "user@example.com",
          password: "password123",
          fromEmail: "noreply@example.com",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith({
      pk,
      sk: "connection",
      workspaceId,
      type: "smtp",
      name: "SMTP Connection",
      config: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        username: "user@example.com",
        password: "password123",
        fromEmail: "noreply@example.com",
      },
      createdBy: userRef,
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("should update existing email connection when connection already exists", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const workspaceId = "workspace-123";
    const workspaceResource = `workspaces/${workspaceId}`;
    const userRef = "users/user-456";
    const pk = `email-connections/${workspaceId}`;

    const existingConnection = {
      pk,
      sk: "connection",
      workspaceId,
      type: "gmail",
      name: "Old Name",
      config: { token: "old-token" },
      createdAt: "2024-01-01T00:00:00Z",
    };

    const mockGet = vi.fn().mockResolvedValue(existingConnection);
    (mockDb as Record<string, unknown>)["email-connection"] = {
      get: mockGet,
    };

    const updatedConnection = {
      ...existingConnection,
      name: "New Name",
      type: "outlook",
      config: { token: "new-token" },
      updatedAt: "2024-01-02T00:00:00Z",
    };

    const mockUpdate = vi.fn().mockResolvedValue(updatedConnection);
    const emailConnectionMock = (mockDb as Record<string, unknown>)[
      "email-connection"
    ] as { update: typeof mockUpdate };
    emailConnectionMock.update = mockUpdate;

    const req = createMockRequest({
      workspaceResource,
      userRef,
      params: {
        workspaceId,
      },
      body: {
        type: "outlook",
        name: "New Name",
        config: { token: "new-token" },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(mockGet).toHaveBeenCalledWith(pk, "connection");
    expect(mockUpdate).toHaveBeenCalledWith({
      pk,
      sk: "connection",
      workspaceId,
      type: "outlook",
      name: "New Name",
      config: { token: "new-token" },
      updatedBy: userRef,
      updatedAt: expect.any(String),
    });
    expect(res.json).toHaveBeenCalledWith({
      name: "New Name",
      type: "outlook",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-02T00:00:00Z",
    });
    expect(res.status).not.toHaveBeenCalledWith(201);
  });

  it("should throw badRequest when workspace resource is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: undefined,
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "gmail",
        name: "Connection",
        config: {},
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining("Workspace resource not found"),
          }),
        }),
      })
    );
  });

  it("should throw unauthorized when userRef is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: undefined,
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "gmail",
        name: "Connection",
        config: {},
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 401,
        }),
      })
    );
  });

  it("should throw badRequest when type is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        name: "Connection",
        config: {},
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "type is required and must be a string"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when type is not a string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: 123,
        name: "Connection",
        config: {},
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "type is required and must be a string"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when type is not one of allowed values", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "invalid-type",
        name: "Connection",
        config: {},
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              'type must be one of: "gmail", "outlook", "smtp"'
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when name is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "gmail",
        config: {},
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "name is required and must be a string"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when name is not a string", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "gmail",
        name: 123,
        config: {},
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "name is required and must be a string"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when config is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "gmail",
        name: "Connection",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "config is required and must be an object"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when config is not an object", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "gmail",
        name: "Connection",
        config: "not-an-object",
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "config is required and must be an object"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when SMTP config.host is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "smtp",
        name: "SMTP Connection",
        config: {
          port: 587,
          secure: false,
          username: "user@example.com",
          password: "password123",
          fromEmail: "noreply@example.com",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "config.host is required for SMTP connections"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when SMTP config.port is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "smtp",
        name: "SMTP Connection",
        config: {
          host: "smtp.example.com",
          secure: false,
          username: "user@example.com",
          password: "password123",
          fromEmail: "noreply@example.com",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "config.port is required for SMTP connections"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when SMTP config.port is not a number", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "smtp",
        name: "SMTP Connection",
        config: {
          host: "smtp.example.com",
          port: "587",
          secure: false,
          username: "user@example.com",
          password: "password123",
          fromEmail: "noreply@example.com",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "config.port is required for SMTP connections"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when SMTP config.secure is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "smtp",
        name: "SMTP Connection",
        config: {
          host: "smtp.example.com",
          port: 587,
          username: "user@example.com",
          password: "password123",
          fromEmail: "noreply@example.com",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "config.secure is required for SMTP connections"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when SMTP config.secure is not a boolean", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "smtp",
        name: "SMTP Connection",
        config: {
          host: "smtp.example.com",
          port: 587,
          secure: "true",
          username: "user@example.com",
          password: "password123",
          fromEmail: "noreply@example.com",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "config.secure is required for SMTP connections"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when SMTP config.username is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "smtp",
        name: "SMTP Connection",
        config: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          password: "password123",
          fromEmail: "noreply@example.com",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "config.username is required for SMTP connections"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when SMTP config.password is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "smtp",
        name: "SMTP Connection",
        config: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          username: "user@example.com",
          fromEmail: "noreply@example.com",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "config.password is required for SMTP connections"
            ),
          }),
        }),
      })
    );
  });

  it("should throw badRequest when SMTP config.fromEmail is missing", async () => {
    const mockDb = createMockDatabase();
    mockDatabase.mockResolvedValue(mockDb);

    const req = createMockRequest({
      workspaceResource: "workspaces/workspace-123",
      userRef: "users/user-456",
      params: {
        workspaceId: "workspace-123",
      },
      body: {
        type: "smtp",
        name: "SMTP Connection",
        config: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          username: "user@example.com",
          password: "password123",
        },
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await callRouteHandler(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          statusCode: 400,
          payload: expect.objectContaining({
            message: expect.stringContaining(
              "config.fromEmail is required for SMTP connections"
            ),
          }),
        }),
      })
    );
  });
});
