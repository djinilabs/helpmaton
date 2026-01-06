import express, { type Express, type RequestHandler } from "express";

/**
 * Creates a test Express app that captures route handlers for testing
 * This allows us to test the actual route handlers instead of inlined implementations
 */
export function createTestAppWithHandlerCapture(): {
  app: Express;
  getHandler: (path: string) => RequestHandler | undefined;
  postHandler: (path: string) => RequestHandler | undefined;
  putHandler: (path: string) => RequestHandler | undefined;
  patchHandler: (path: string) => RequestHandler | undefined;
  deleteHandler: (path: string) => RequestHandler | undefined;
} {
  const app = express();
  app.use(express.json());

  const handlers = new Map<string, RequestHandler>();

  // Wrap Express methods to capture handlers
  const originalGet = app.get.bind(app);
  const originalPost = app.post.bind(app);
  const originalPut = app.put.bind(app);
  const originalPatch = app.patch.bind(app);
  const originalDelete = app.delete.bind(app);

  // Wrap Express methods to capture handlers
  // Using type assertion to avoid complex Express type matching issues in tests
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).get = function (
    path: string,
    ...routeHandlers: RequestHandler[]
  ): Express {
    // Store the last handler (the actual route handler, after middleware)
    if (routeHandlers.length > 0) {
      handlers.set(`GET ${path}`, routeHandlers[routeHandlers.length - 1]);
    }
    return originalGet(path, ...routeHandlers);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).post = function (
    path: string,
    ...routeHandlers: RequestHandler[]
  ): Express {
    if (routeHandlers.length > 0) {
      handlers.set(`POST ${path}`, routeHandlers[routeHandlers.length - 1]);
    }
    return originalPost(path, ...routeHandlers);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).put = function (
    path: string,
    ...routeHandlers: RequestHandler[]
  ): Express {
    if (routeHandlers.length > 0) {
      handlers.set(`PUT ${path}`, routeHandlers[routeHandlers.length - 1]);
    }
    return originalPut(path, ...routeHandlers);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).patch = function (
    path: string,
    ...routeHandlers: RequestHandler[]
  ): Express {
    if (routeHandlers.length > 0) {
      handlers.set(`PATCH ${path}`, routeHandlers[routeHandlers.length - 1]);
    }
    return originalPatch(path, ...routeHandlers);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app as any).delete = function (
    path: string,
    ...routeHandlers: RequestHandler[]
  ): Express {
    if (routeHandlers.length > 0) {
      handlers.set(`DELETE ${path}`, routeHandlers[routeHandlers.length - 1]);
    }
    return originalDelete(path, ...routeHandlers);
  };

  return {
    app,
    getHandler: (path: string) => handlers.get(`GET ${path}`),
    postHandler: (path: string) => handlers.get(`POST ${path}`),
    putHandler: (path: string) => handlers.get(`PUT ${path}`),
    patchHandler: (path: string) => handlers.get(`PATCH ${path}`),
    deleteHandler: (path: string) => handlers.get(`DELETE ${path}`),
  };
}





