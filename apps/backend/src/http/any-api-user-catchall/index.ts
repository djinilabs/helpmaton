import serverlessExpress from "@vendia/serverless-express";
import { APIGatewayProxyHandlerV2, APIGatewayProxyResultV2 } from "aws-lambda";

import { handlingErrors } from "../../utils/handlingErrors";
import { adaptHttpHandler } from "../../utils/httpEventAdapter";
import { initSentry } from "../../utils/sentry";

import { createApp } from "./user-app";

initSentry();

let cachedHandler: APIGatewayProxyHandlerV2 | undefined;

const createHandler = async (): Promise<APIGatewayProxyHandlerV2> => {
  if (cachedHandler) {
    return cachedHandler;
  }
  try {
    const app = createApp();
    const handler = handlingErrors(
      serverlessExpress({
        app,
        respondWithErrors: true,
      })
    );
    cachedHandler = handler;
    return handler;
  } catch (error) {
    console.error("[user] Error creating app:", error);
    if (error instanceof Error) {
      console.error("[user] Error stack:", error.stack);
    }
    throw error;
  }
};

export const handler = adaptHttpHandler(
  handlingErrors(async (...args: Parameters<APIGatewayProxyHandlerV2>) => {
    try {
      const h: APIGatewayProxyHandlerV2 = await createHandler();
      return (await h(...args)) as APIGatewayProxyResultV2;
    } catch (error) {
      console.error("[user] Error in handler:", error);
      if (error instanceof Error) {
        console.error("[user] Error stack:", error.stack);
      }
      throw error;
    }
  })
);
