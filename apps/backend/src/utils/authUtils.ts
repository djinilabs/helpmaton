import { tables } from "@architect/functions";
import type { AdapterUser } from "@auth/core/adapters";
import { DynamoDBAdapter } from "@auth/dynamodb-adapter";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocument,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

import { once } from "../utils";

/**
 * Get the DynamoDBAdapter instance for authentication
 * This function handles both production and sandbox environments
 * @returns DynamoDBAdapter instance
 */
export const getDynamoDBAdapter = once(async () => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  const client = await tables({
    awsSdkClient: true,
    awsjsonMarshall: { convertClassInstanceToMap: true },
    awsjsonUnmarshall: { convertWithoutMapWrapper: false },
  });
  const tableName = await client.name("next-auth");

  // Get the underlying DynamoDB client from the Architect tables client
  // The _doc property contains the DynamoDBDocument client
  let clientDoc: DynamoDBDocument = client._doc as unknown as DynamoDBDocument;

  // In sandbox mode, ensure the endpoint is configured
  // Architect should set this automatically, but sometimes it needs to be explicit
  if (process.env.ARC_SANDBOX) {
    try {
      const sandboxConfig = JSON.parse(process.env.ARC_SANDBOX);
      const tablesPort = sandboxConfig?.ports?.tables;

      if (tablesPort) {
        // The endpoint should be http://localhost:{tablesPort}
        const endpoint = `http://localhost:${tablesPort}`;

        // Try to access and configure the underlying client
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const docClient = clientDoc as any;

        // DynamoDBDocumentClient structure: config.service.client is the DynamoDBClient
        const underlyingClient = docClient.config?.service?.client as
          | DynamoDBClient
          | undefined;

        if (underlyingClient) {
          // Create a new DynamoDBClient with the endpoint explicitly set
          const dynamoClient = new DynamoDBClient({
            endpoint: endpoint,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            region: (underlyingClient.config as any)?.region || "eu-west-2",
            credentials: {
              accessKeyId: "dummy",
              secretAccessKey: "dummy",
            },
          });

          // Create a new DynamoDBDocumentClient with the configured client
          clientDoc = DynamoDBDocumentClient.from(dynamoClient, {
            marshallOptions: {
              convertClassInstanceToMap: true,
            },
            unmarshallOptions: {
              convertWithoutMapWrapper: false,
            },
          }) as unknown as DynamoDBDocument;
        }
      }
    } catch (e) {
      console.warn("Could not configure endpoint:", e);
    }
  }

  // Configure DynamoDBAdapter to use GSI1PK/GSI1SK for the index keys
  // This change enables email-based user lookups via the GSI1 index
  // (see getUserByEmail in subscriptionUtils.ts)
  // The adapter will use these keys when querying by email or account provider
  const baseAdapter = DynamoDBAdapter(clientDoc, {
    tableName,
    indexPartitionKey: "gsi1pk",
    indexSortKey: "gsi1sk",
    indexName: "GSI2",
  });

  // Wrap adapter to track user_signed_up when the user record is created (not at login).
  // Tracking is best-effort: if trackEvent throws, we log and still return the created user so sign-up never fails.
  return {
    ...baseAdapter,
    createUser: async (user: AdapterUser) => {
      const createdUser = await baseAdapter.createUser!(user);
      try {
        const { trackEvent } = await import("./tracking");
        trackEvent("user_signed_up", {
          user_id: createdUser.id,
          user_email: createdUser.email ?? undefined,
        });
      } catch (error) {
        console.warn(
          "[authUtils] Failed to track user_signed_up:",
          error instanceof Error ? error.message : String(error)
        );
      }
      return createdUser;
    },
  };
});
