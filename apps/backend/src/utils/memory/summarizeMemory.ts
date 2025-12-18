import { generateText } from "ai";

import { createModel } from "../../http/utils/modelFactory";
import type { TemporalGrain } from "../vectordb/types";

/**
 * Get the system prompt for summarizing memory at a specific grain level
 */
export function getSummarizationPrompt(grain: TemporalGrain): string {
  switch (grain) {
    case "daily":
      return `You are summarizing daily events from working memory. Extract and summarize the most important facts, occurrences, and people mentioned. Focus on:
- Important events and occurrences
- Key people mentioned and their roles/relationships
- Significant facts and information
- Any notable patterns or trends

Keep the summary concise but comprehensive. Use clear, factual language.`;
    case "weekly":
      return `You are summarizing a week's worth of daily summaries. Extract and consolidate the most important facts, occurrences, and people across the week. Focus on:
- Major events and occurrences throughout the week
- Key people and their evolving roles/relationships
- Important patterns, trends, or changes
- Significant facts that remain relevant

Create a cohesive narrative of the week's most important information.`;
    case "monthly":
      return `You are summarizing a month's worth of weekly summaries. Extract and consolidate the most important facts, occurrences, and people across the month. Focus on:
- Major events and milestones throughout the month
- Key people and their relationships/roles
- Important patterns, trends, or changes over time
- Significant facts and information that remain relevant

Create a high-level overview of the month's most important information.`;
    case "quarterly":
      return `You are summarizing a quarter's worth of monthly summaries. Extract and consolidate the most important facts, occurrences, and people across the quarter. Focus on:
- Major events and milestones throughout the quarter
- Key people and their relationships/roles
- Important patterns, trends, or changes over time
- Significant facts and information that remain relevant

Create a high-level overview of the quarter's most important information.`;
    case "yearly":
      return `You are summarizing a year's worth of quarterly summaries. Extract and consolidate the most important facts, occurrences, and people across the year. Focus on:
- Major events and milestones throughout the year
- Key people and their relationships/roles
- Important patterns, trends, or changes over time
- Significant facts and information that remain relevant

Create a high-level overview of the year's most important information.`;
    default:
      throw new Error(`Summarization not supported for grain: ${grain}`);
  }
}

/**
 * Summarize content using an LLM
 * @param content - Array of content strings to summarize
 * @param summaryType - The temporal grain type for the summary
 * @param workspaceId - Optional workspace ID for API key lookup
 * @returns Summarized text
 */
export async function summarizeWithLLM(
  content: string[],
  summaryType: TemporalGrain,
  workspaceId?: string
): Promise<string> {
  if (content.length === 0) {
    return "";
  }

  // Combine all content into a single text
  const combinedContent = content.join("\n\n---\n\n");

  // Get the system prompt for this grain type
  const systemPrompt = getSummarizationPrompt(summaryType);

  // Create model (will use workspace API key if available, otherwise system key)
  const model = await createModel(
    "google",
    undefined, // Use default model
    workspaceId,
    "http://localhost:3000/api/memory-summarization"
  );

  // Generate summary
  const result = await generateText({
    model: model as unknown as Parameters<typeof generateText>[0]["model"],
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Please summarize the following information:\n\n${combinedContent}`,
      },
    ],
  });

  return result.text.trim();
}

