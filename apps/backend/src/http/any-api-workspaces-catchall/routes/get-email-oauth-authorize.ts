import { badRequest } from "@hapi/boom";
import express from "express";

import { PERMISSION_LEVELS } from "../../../tables/schema";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/email/oauth/{provider}/authorize:
 *   get:
 *     summary: Get email OAuth authorization URL
 *     description: Returns the OAuth authorization URL for Gmail or Outlook email connection setup
 *     tags:
 *       - Email
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: provider
 *         in: path
 *         required: true
 *         description: Email provider
 *         schema:
 *           type: string
 *           enum: [gmail, outlook]
 *     responses:
 *       200:
 *         description: OAuth authorization URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authUrl:
 *                   type: string
 *                   format: uri
 *                   description: OAuth authorization URL to redirect user to
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerGetEmailOauthAuthorize = (app: express.Application) => {
  app.get(
    "/api/workspaces/:workspaceId/email/oauth/:provider/authorize",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const workspaceId = req.params.workspaceId;
        const provider = req.params.provider as "gmail" | "outlook";

        if (!["gmail", "outlook"].includes(provider)) {
          throw badRequest('provider must be "gmail" or "outlook"');
        }

        // Generate authorization URL (state token includes workspaceId)
        let authUrl: string;
        if (provider === "gmail") {
          const { generateGmailAuthUrl } = await import(
            "../../../utils/oauth/gmail"
          );
          authUrl = generateGmailAuthUrl(workspaceId);
        } else {
          const { generateOutlookAuthUrl } = await import(
            "../../../utils/oauth/outlook"
          );
          authUrl = generateOutlookAuthUrl(workspaceId);
        }

        res.json({ authUrl });
      } catch (error) {
        handleError(
          error,
          next,
          "GET /api/workspaces/:workspaceId/email/oauth/:provider/authorize"
        );
      }
    }
  );
};
