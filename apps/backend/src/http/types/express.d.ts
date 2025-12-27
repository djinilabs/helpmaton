import type { Session } from "@auth/express";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";

declare global {
  namespace Express {
    interface Request {
      session?: Session;
      userRef?: string;
      workspaceResource?: string;
      apiGateway?: {
        event?: APIGatewayProxyEventV2;
      };
      files?: Express.Multer.File[];
      file?: Express.Multer.File;
      context?: Context;
    }
  }
}

