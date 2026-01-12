import { z } from "zod";

/**
 * Subscription schemas
 */

export const modifySubscriptionSchema = z.object({
  plan: z.enum(["starter", "pro"]),
}).strict();
