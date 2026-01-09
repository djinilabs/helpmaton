import { badRequest, forbidden, resourceGone } from "@hapi/boom";
import express from "express";

import { database } from "../../../tables";
import { PERMISSION_LEVELS } from "../../../tables/schema";
import { isValidAvatar } from "../../../utils/avatarUtils";
import { trackBusinessEvent } from "../../../utils/tracking";
import { handleError, requireAuth, requirePermission } from "../middleware";

/**
 * @openapi
 * /api/workspaces/{workspaceId}/agents/{agentId}:
 *   put:
 *     summary: Update workspace agent
 *     description: Updates agent configuration. Validates delegation chains to prevent circular references.
 *     tags:
 *       - Agents
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: workspaceId
 *         in: path
 *         required: true
 *         description: Workspace ID
 *         schema:
 *           type: string
 *       - name: agentId
 *         in: path
 *         required: true
 *         description: Agent ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAgentRequest'
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/Agent'
 *                 - type: object
 *                   properties:
 *                     spendingLimits:
 *                       type: array
 *                       items:
 *                         type: object
 *                     temperature:
 *                       type: number
 *                       nullable: true
 *                     topP:
 *                       type: number
 *                       nullable: true
 *                     topK:
 *                       type: integer
 *                       nullable: true
 *                     maxOutputTokens:
 *                       type: integer
 *                       nullable: true
 *                     stopSequences:
 *                       type: array
 *                       items:
 *                         type: string
 *                       nullable: true
 *                     maxToolRoundtrips:
 *                       type: integer
 *                       nullable: true
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       410:
 *         description: Agent or related resource not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
export const registerPutWorkspaceAgent = (app: express.Application) => {
  app.put(
    "/api/workspaces/:workspaceId/agents/:agentId",
    requireAuth,
    requirePermission(PERMISSION_LEVELS.WRITE),
    async (req, res, next) => {
      try {
        const {
          name,
          systemPrompt,
          notificationChannelId,
          spendingLimits,
          delegatableAgentIds,
          enabledMcpServerIds,
          enableMemorySearch,
          enableSearchDocuments,
          enableSendEmail,
          enableTavilySearch,
          searchWebProvider,
          enableTavilyFetch, // Legacy field for backward compatibility
          fetchWebProvider,
          enableExaSearch,
          clientTools,
          widgetConfig,
          temperature,
          topP,
          topK,
          maxOutputTokens,
          stopSequences,
          maxToolRoundtrips,
          modelName,
          avatar,
        } = req.body;
        const db = await database();
        const workspaceResource = req.workspaceResource;
        if (!workspaceResource) {
          throw badRequest("Workspace resource not found");
        }
        const workspaceId = req.params.workspaceId;
        const agentId = req.params.agentId;
        const agentPk = `agents/${workspaceId}/${agentId}`;

        const agent = await db.agent.get(agentPk, "agent");
        if (!agent) {
          throw resourceGone("Agent not found");
        }

        // Validate notificationChannelId if provided
        if (
          notificationChannelId !== undefined &&
          notificationChannelId !== null
        ) {
          if (typeof notificationChannelId !== "string") {
            throw badRequest("notificationChannelId must be a string or null");
          }
          // Verify channel exists and belongs to workspace
          const channelPk = `output-channels/${workspaceId}/${notificationChannelId}`;
          const channel = await db["output_channel"].get(channelPk, "channel");
          if (!channel) {
            throw resourceGone("Notification channel not found");
          }
          if (channel.workspaceId !== workspaceId) {
            throw forbidden(
              "Notification channel does not belong to this workspace"
            );
          }
        }

        // Validate spendingLimits if provided
        if (spendingLimits !== undefined) {
          if (!Array.isArray(spendingLimits)) {
            throw badRequest("spendingLimits must be an array");
          }
          for (const limit of spendingLimits) {
            if (
              !limit.timeFrame ||
              !["daily", "weekly", "monthly"].includes(limit.timeFrame)
            ) {
              throw badRequest(
                "Each spending limit must have a valid timeFrame (daily, weekly, or monthly)"
              );
            }
            if (typeof limit.amount !== "number" || limit.amount < 0) {
              throw badRequest(
                "Each spending limit must have a non-negative amount"
              );
            }
          }
        }

        // Validate delegatableAgentIds if provided
        if (delegatableAgentIds !== undefined) {
          if (!Array.isArray(delegatableAgentIds)) {
            throw badRequest("delegatableAgentIds must be an array");
          }
          // Validate all items are strings
          for (const id of delegatableAgentIds) {
            if (typeof id !== "string") {
              throw badRequest("All delegatableAgentIds must be strings");
            }
            // Cannot delegate to self
            if (id === agentId) {
              throw badRequest("Agent cannot delegate to itself");
            }
            // Verify agent exists and belongs to workspace
            const targetAgentPk = `agents/${workspaceId}/${id}`;
            const targetAgent = await db.agent.get(targetAgentPk, "agent");
            if (!targetAgent) {
              throw resourceGone(`Delegatable agent ${id} not found`);
            }
            if (targetAgent.workspaceId !== workspaceId) {
              throw forbidden(
                `Delegatable agent ${id} does not belong to this workspace`
              );
            }
          }

          // Check for circular delegation chains
          // Fetch all agents in the workspace to build a lookup map
          const allAgentsQuery = await db.agent.query({
            IndexName: "byWorkspaceId",
            KeyConditionExpression: "workspaceId = :workspaceId",
            ExpressionAttributeValues: {
              ":workspaceId": workspaceId,
            },
          });
          const agentMap = new Map<
            string,
            { delegatableAgentIds?: string[] }
          >();
          for (const a of allAgentsQuery.items) {
            agentMap.set(a.pk.replace(`agents/${workspaceId}/`, ""), {
              delegatableAgentIds: a.delegatableAgentIds,
            });
          }
          // Use the new delegatableAgentIds for the current agent
          agentMap.set(agentId, { delegatableAgentIds });

          // Helper function to detect cycles using DFS
          function hasDelegationCycle(
            startId: string,
            currentId: string,
            visited: Set<string>
          ): boolean {
            if (visited.has(currentId)) return false;
            visited.add(currentId);
            const entry = agentMap.get(currentId);
            if (!entry || !entry.delegatableAgentIds) return false;
            for (const nextId of entry.delegatableAgentIds) {
              if (nextId === startId) {
                return true;
              }
              if (hasDelegationCycle(startId, nextId, visited)) {
                return true;
              }
            }
            return false;
          }

          for (const id of delegatableAgentIds) {
            if (hasDelegationCycle(agentId, id, new Set([agentId]))) {
              throw badRequest(
                "Circular delegation detected: this update would create a cycle in the delegation graph"
              );
            }
          }
        }

        // Validate enabledMcpServerIds if provided
        if (enabledMcpServerIds !== undefined) {
          if (!Array.isArray(enabledMcpServerIds)) {
            throw badRequest("enabledMcpServerIds must be an array");
          }
          // Validate all items are strings
          for (const id of enabledMcpServerIds) {
            if (typeof id !== "string") {
              throw badRequest("All enabledMcpServerIds must be strings");
            }
            // Verify MCP server exists and belongs to workspace
            const serverPk = `mcp-servers/${workspaceId}/${id}`;
            const server = await db["mcp-server"].get(serverPk, "server");
            if (!server) {
              throw resourceGone(`MCP server ${id} not found`);
            }
            if (server.workspaceId !== workspaceId) {
              throw forbidden(
                `MCP server ${id} does not belong to this workspace`
              );
            }
          }
        }

        // Validate clientTools if provided
        if (clientTools !== undefined) {
          if (!Array.isArray(clientTools)) {
            throw badRequest("clientTools must be an array");
          }
          for (const tool of clientTools) {
            if (
              !tool ||
              typeof tool !== "object" ||
              typeof tool.name !== "string" ||
              typeof tool.description !== "string" ||
              !tool.parameters ||
              typeof tool.parameters !== "object"
            ) {
              throw badRequest(
                "Each client tool must have name, description (both strings) and parameters (object)"
              );
            }
            // Validate name is a valid JavaScript identifier
            if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(tool.name)) {
              throw badRequest(
                `Tool name "${tool.name}" must be a valid JavaScript identifier (letters, numbers, underscore, $; no spaces or special characters)`
              );
            }
          }
        }

        // Validate widgetConfig if provided
        if (widgetConfig !== undefined) {
          if (widgetConfig !== null && typeof widgetConfig !== "object") {
            throw badRequest("widgetConfig must be an object or null");
          }
          if (widgetConfig) {
            if (
              "enabled" in widgetConfig &&
              typeof widgetConfig.enabled !== "boolean"
            ) {
              throw badRequest("widgetConfig.enabled must be a boolean");
            }
            if (
              "allowedOrigins" in widgetConfig &&
              widgetConfig.allowedOrigins !== undefined &&
              !Array.isArray(widgetConfig.allowedOrigins)
            ) {
              throw badRequest(
                "widgetConfig.allowedOrigins must be an array of strings"
              );
            }
            if (
              widgetConfig.allowedOrigins &&
              !widgetConfig.allowedOrigins.every(
                (origin: unknown) => typeof origin === "string"
              )
            ) {
              throw badRequest(
                "All items in widgetConfig.allowedOrigins must be strings"
              );
            }
            if (
              "theme" in widgetConfig &&
              widgetConfig.theme !== undefined &&
              !["light", "dark", "auto"].includes(widgetConfig.theme)
            ) {
              throw badRequest(
                "widgetConfig.theme must be 'light', 'dark', or 'auto'"
              );
            }
            if (
              "position" in widgetConfig &&
              widgetConfig.position !== undefined &&
              !["bottom-right", "bottom-left", "top-right", "top-left"].includes(
                widgetConfig.position
              )
            ) {
              throw badRequest(
                "widgetConfig.position must be 'bottom-right', 'bottom-left', 'top-right', or 'top-left'"
              );
            }
          }
        }

        // Validate model configuration fields if provided (null is allowed to clear values)
        if (temperature !== undefined && temperature !== null) {
          if (
            typeof temperature !== "number" ||
            temperature < 0 ||
            temperature > 2
          ) {
            throw badRequest("temperature must be a number between 0 and 2");
          }
        }

        if (topP !== undefined && topP !== null) {
          if (typeof topP !== "number" || topP < 0 || topP > 1) {
            throw badRequest("topP must be a number between 0 and 1");
          }
        }

        if (topK !== undefined && topK !== null) {
          if (
            typeof topK !== "number" ||
            !Number.isInteger(topK) ||
            topK <= 0
          ) {
            throw badRequest("topK must be a positive integer");
          }
        }

        if (maxOutputTokens !== undefined && maxOutputTokens !== null) {
          if (
            typeof maxOutputTokens !== "number" ||
            !Number.isInteger(maxOutputTokens) ||
            maxOutputTokens <= 0
          ) {
            throw badRequest("maxOutputTokens must be a positive integer");
          }
        }

        if (stopSequences !== undefined && stopSequences !== null) {
          if (!Array.isArray(stopSequences)) {
            throw badRequest("stopSequences must be an array");
          }
          for (const seq of stopSequences) {
            if (typeof seq !== "string") {
              throw badRequest("All stopSequences must be strings");
            }
          }
        }

        if (maxToolRoundtrips !== undefined && maxToolRoundtrips !== null) {
          if (
            typeof maxToolRoundtrips !== "number" ||
            !Number.isInteger(maxToolRoundtrips) ||
            maxToolRoundtrips <= 0
          ) {
            throw badRequest("maxToolRoundtrips must be a positive integer");
          }
        }

        // Validate modelName if provided
        if (modelName !== undefined && modelName !== null) {
          if (typeof modelName !== "string" || modelName.trim().length === 0) {
            throw badRequest("modelName must be a non-empty string or null");
          }
          // Validate model exists in pricing config
          const { getModelPricing } = await import("../../../utils/pricing");
          const pricing = getModelPricing("google", modelName.trim());
          if (!pricing) {
            throw badRequest(
              `Model "${modelName.trim()}" is not available. Please check available models at /api/models`
            );
          }
        }

        // Validate avatar if provided
        if (avatar !== undefined && avatar !== null) {
          if (typeof avatar !== "string") {
            throw badRequest("avatar must be a string or null");
          }
          if (!isValidAvatar(avatar)) {
            throw badRequest(
              `Invalid avatar path. Avatar must be one of the available logo paths.`
            );
          }
        }

        // Handle searchWebProvider with backward compatibility for enableTavilySearch
        let resolvedSearchWebProvider: "tavily" | "jina" | undefined;
        if (searchWebProvider !== undefined) {
          // New field takes precedence
          if (searchWebProvider !== null && searchWebProvider !== "tavily" && searchWebProvider !== "jina") {
            throw badRequest(
              "searchWebProvider must be 'tavily', 'jina', or null"
            );
          }
          resolvedSearchWebProvider = searchWebProvider === null ? undefined : searchWebProvider;
        } else if (enableTavilySearch !== undefined) {
          // Legacy field: migrate to new field
          resolvedSearchWebProvider = enableTavilySearch === true ? "tavily" : undefined;
        } else {
          // Keep existing value
          resolvedSearchWebProvider = agent.searchWebProvider;
        }

        // Handle fetchWebProvider with backward compatibility for enableTavilyFetch
        let resolvedFetchWebProvider: "tavily" | "jina" | "scrape" | undefined;
        if (fetchWebProvider !== undefined) {
          // New field takes precedence
          if (
            fetchWebProvider !== null &&
            fetchWebProvider !== "tavily" &&
            fetchWebProvider !== "jina" &&
            fetchWebProvider !== "scrape"
          ) {
            throw badRequest(
              "fetchWebProvider must be 'tavily', 'jina', 'scrape', or null"
            );
          }
          resolvedFetchWebProvider = fetchWebProvider === null ? undefined : fetchWebProvider;
        } else if (enableTavilyFetch !== undefined) {
          // Legacy field: migrate to new field
          resolvedFetchWebProvider = enableTavilyFetch === true ? "tavily" : undefined;
        } else {
          // Keep existing value
          resolvedFetchWebProvider = agent.fetchWebProvider;
        }

        // Update agent
        // Convert null to undefined for optional fields to match schema
        const updated = await db.agent.update({
          pk: agentPk,
          sk: "agent",
          workspaceId,
          name: name !== undefined ? name : agent.name,
          systemPrompt:
            systemPrompt !== undefined ? systemPrompt : agent.systemPrompt,
          notificationChannelId:
            notificationChannelId !== undefined
              ? notificationChannelId === null
                ? undefined
                : notificationChannelId
              : agent.notificationChannelId,
          delegatableAgentIds:
            delegatableAgentIds !== undefined
              ? delegatableAgentIds
              : agent.delegatableAgentIds,
          enabledMcpServerIds:
            enabledMcpServerIds !== undefined
              ? enabledMcpServerIds
              : agent.enabledMcpServerIds,
          enableMemorySearch:
            enableMemorySearch !== undefined
              ? enableMemorySearch
              : agent.enableMemorySearch,
          enableSearchDocuments:
            enableSearchDocuments !== undefined
              ? enableSearchDocuments
              : agent.enableSearchDocuments,
          enableSendEmail:
            enableSendEmail !== undefined
              ? enableSendEmail
              : agent.enableSendEmail,
          enableTavilySearch:
            enableTavilySearch !== undefined
              ? enableTavilySearch
              : agent.enableTavilySearch,
          searchWebProvider: resolvedSearchWebProvider,
          fetchWebProvider: resolvedFetchWebProvider,
          enableExaSearch:
            enableExaSearch !== undefined
              ? enableExaSearch
              : agent.enableExaSearch,
          clientTools:
            clientTools !== undefined ? clientTools : agent.clientTools,
          widgetConfig:
            widgetConfig !== undefined
              ? widgetConfig === null
                ? undefined
                : widgetConfig
              : agent.widgetConfig,
          spendingLimits:
            spendingLimits !== undefined
              ? spendingLimits
              : agent.spendingLimits,
          temperature:
            temperature !== undefined
              ? temperature === null
                ? undefined
                : temperature
              : agent.temperature,
          topP:
            topP !== undefined
              ? topP === null
                ? undefined
                : topP
              : agent.topP,
          topK:
            topK !== undefined
              ? topK === null
                ? undefined
                : topK
              : agent.topK,
          maxOutputTokens:
            maxOutputTokens !== undefined
              ? maxOutputTokens === null
                ? undefined
                : maxOutputTokens
              : agent.maxOutputTokens,
          stopSequences:
            stopSequences !== undefined
              ? stopSequences === null
                ? undefined
                : stopSequences
              : agent.stopSequences,
          maxToolRoundtrips:
            maxToolRoundtrips !== undefined
              ? maxToolRoundtrips === null
                ? undefined
                : maxToolRoundtrips
              : agent.maxToolRoundtrips,
          modelName:
            modelName !== undefined
              ? modelName === null
                ? undefined
                : modelName.trim()
              : agent.modelName,
          avatar:
            avatar !== undefined
              ? avatar === null
                ? undefined
                : avatar
              : agent.avatar,
          updatedBy: req.userRef || "",
          updatedAt: new Date().toISOString(),
        });

        const response = {
          id: agentId,
          name: updated.name,
          systemPrompt: updated.systemPrompt,
          notificationChannelId: updated.notificationChannelId,
          delegatableAgentIds: updated.delegatableAgentIds ?? [],
          enabledMcpServerIds: updated.enabledMcpServerIds ?? [],
          enableMemorySearch: updated.enableMemorySearch ?? false,
          enableSearchDocuments: updated.enableSearchDocuments ?? false,
          enableSendEmail: updated.enableSendEmail ?? false,
          enableTavilySearch: updated.enableTavilySearch ?? false,
          searchWebProvider: updated.searchWebProvider ?? null,
          fetchWebProvider: updated.fetchWebProvider ?? null,
          enableExaSearch: updated.enableExaSearch ?? false,
          clientTools: updated.clientTools ?? [],
          spendingLimits: updated.spendingLimits ?? [],
          temperature: updated.temperature ?? null,
          topP: updated.topP ?? null,
          topK: updated.topK ?? null,
          maxOutputTokens: updated.maxOutputTokens ?? null,
          stopSequences: updated.stopSequences ?? null,
          maxToolRoundtrips: updated.maxToolRoundtrips ?? null,
          provider: updated.provider,
          modelName: updated.modelName ?? null,
          avatar: updated.avatar ?? null,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };

        // Track agent update
        trackBusinessEvent(
          "agent",
          "updated",
          {
            workspace_id: workspaceId,
            agent_id: agentId,
            provider: updated.provider,
            model_name: updated.modelName || undefined,
          },
          req
        );

        res.json(response);
      } catch (error) {
        handleError(
          error,
          next,
          "PUT /api/workspaces/:workspaceId/agents/:agentId"
        );
      }
    }
  );
};
