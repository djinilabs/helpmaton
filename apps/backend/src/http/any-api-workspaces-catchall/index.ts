import serverlessExpress from "@vendia/serverless-express";
import { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";

import { createApp } from "./workspaces-app";

let cachedHandler: APIGatewayProxyHandlerV2 | undefined;

const createHandler = async (): Promise<APIGatewayProxyHandlerV2> => {
  if (cachedHandler) {
    return cachedHandler;
  }
  try {
    const app = await createApp();
    const handler = handlingErrors(
      serverlessExpress({
        app,
        respondWithErrors: true,
      })
    );
    cachedHandler = handler;
    return handler;
  } catch (error) {
    console.error("[workspaces] Error creating app:", error);
    if (error instanceof Error) {
      console.error("[workspaces] Error stack:", error.stack);
    }
    throw error;
  }
};

export const handler = adaptHttpHandler(
  async (...args: Parameters<APIGatewayProxyHandlerV2>) => {
    try {
      // createHandler() already wraps with handlingErrors, so we don't need to wrap again
      const h: APIGatewayProxyHandlerV2 = await createHandler();
      return (await h(...args)) as APIGatewayProxyResultV2;
    } catch (error) {
      console.error("[workspaces] Error in handler:", error);
      if (error instanceof Error) {
        console.error("[workspaces] Error stack:", error.stack);
      }
      throw error;
    }
  }
);
