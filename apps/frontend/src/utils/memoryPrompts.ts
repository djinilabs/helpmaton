import type { SummarizationPromptGrain, SummarizationPrompts } from "./api";

export const DEFAULT_SUMMARIZATION_PROMPTS: Record<
  SummarizationPromptGrain,
  string
> = {
  daily: `You are summarizing daily events from working memory. Extract and summarize the most important facts, occurrences, and people mentioned. Focus on:
- Important events and occurrences
- Key people mentioned and their roles/relationships
- Significant facts and information
- Any notable patterns or trends

Keep the summary concise but comprehensive. Use clear, factual language.`,
  weekly: `You are summarizing a week's worth of daily summaries. Extract and consolidate the most important facts, occurrences, and people across the week. Focus on:
- Major events and occurrences throughout the week
- Key people and their evolving roles/relationships
- Important patterns, trends, or changes
- Significant facts that remain relevant

Create a cohesive narrative of the week's most important information.`,
  monthly: `You are summarizing a month's worth of weekly summaries. Extract and consolidate the most important facts, occurrences, and people across the month. Focus on:
- Major events and milestones throughout the month
- Key people and their relationships/roles
- Important patterns, trends, or changes over time
- Significant facts and information that remain relevant

Create a high-level overview of the month's most important information.`,
  quarterly: `You are summarizing a quarter's worth of monthly summaries. Extract and consolidate the most important facts, occurrences, and people across the quarter. Focus on:
- Major events and milestones throughout the quarter
- Key people and their relationships/roles
- Important patterns, trends, or changes over time
- Significant facts and information that remain relevant

Create a high-level overview of the quarter's most important information.`,
  yearly: `You are summarizing a year's worth of quarterly summaries. Extract and consolidate the most important facts, occurrences, and people across the year. Focus on:
- Major events and milestones throughout the year
- Key people and their relationships/roles
- Important patterns, trends, or changes over time
- Significant facts and information that remain relevant

Create a high-level overview of the year's most important information.`,
};

export function getDefaultSummarizationPrompt(
  grain: SummarizationPromptGrain
): string {
  return DEFAULT_SUMMARIZATION_PROMPTS[grain];
}

export function getEffectiveSummarizationPrompts(
  overrides?: SummarizationPrompts
): Record<SummarizationPromptGrain, string> {
  return {
    daily: overrides?.daily ?? DEFAULT_SUMMARIZATION_PROMPTS.daily,
    weekly: overrides?.weekly ?? DEFAULT_SUMMARIZATION_PROMPTS.weekly,
    monthly: overrides?.monthly ?? DEFAULT_SUMMARIZATION_PROMPTS.monthly,
    quarterly: overrides?.quarterly ?? DEFAULT_SUMMARIZATION_PROMPTS.quarterly,
    yearly: overrides?.yearly ?? DEFAULT_SUMMARIZATION_PROMPTS.yearly,
  };
}
