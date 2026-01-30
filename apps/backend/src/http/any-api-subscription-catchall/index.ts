import serverlessExpress from "@vendia/serverless-express";
import { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { handlingErrors } from "../../utils/handlingErrors";
import { initSentry } from "../../utils/sentry";

import { createApp } from "./subscription-app";

initSentry();

let cachedHandler: APIGatewayProxyHandlerV2 | undefined;

const createHandler = async (): Promise<APIGatewayProxyHandlerV2> => {
  if (cachedHandler) {
    console.log("[subscription-catchall] Using cached handler");
    return cachedHandler;
  }
  try {
    console.log("[subscription-catchall] Creating app...");
    const app = createApp(); // createApp is not async, so no await needed
    console.log(
      "[subscription-catchall] App created, setting up serverless-express"
    );
    const handler = handlingErrors(
      serverlessExpress({
        app,
        respondWithErrors: true,
      })
    );
    cachedHandler = handler;
    console.log("[subscription-catchall] Handler created and cached");
    return handler;
  } catch (error) {
    console.error("[subscription-catchall] Error creating app:", error);
    if (error instanceof Error) {
      console.error("[subscription-catchall] Error stack:", error.stack);
    }
    throw error;
  }
};

export const handler: APIGatewayProxyHandlerV2 = handlingErrors(
  async (...args: Parameters<APIGatewayProxyHandlerV2>) => {
    console.log(
      "[subscription-catchall] Handler called with args:",
      JSON.stringify(args[0]?.requestContext?.http?.path || "unknown")
    );
    try {
      const h: APIGatewayProxyHandlerV2 = await createHandler();
      console.log("[subscription-catchall] Handler created, calling with args");
      const result = await h(...args);
      console.log(
        "[subscription-catchall] Handler returned result:",
        typeof result === "object" && result !== null
          ? (result as { statusCode?: number }).statusCode
          : "string result"
      );
      return result as APIGatewayProxyResultV2;
    } catch (error) {
      console.error("[subscription-catchall] Error in handler:", error);
      if (error instanceof Error) {
        console.error("[subscription-catchall] Error stack:", error.stack);
      }
      throw error;
    }
  }
);
