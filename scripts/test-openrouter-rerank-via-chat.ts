#!/usr/bin/env tsx
/**
 * Test OpenRouter as a unified API: use the OpenAI-compatible chat completions
 * endpoint to perform a reranking-style task (query + documents → order by relevance).
 * Prompt must stay in sync with apps/backend/src/utils/rerankPrompt.ts (same instructions and format).
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... pnpm exec tsx scripts/test-openrouter-rerank-via-chat.ts
 *   # or with .env: pnpm exec dotenv -e .env -- tsx scripts/test-openrouter-rerank-via-chat.ts
 *
 * Requires OPENROUTER_API_KEY in the environment.
 */

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

function buildRerankPrompt(query: string, documents: string[]): string {
  const docList = documents.map((d, i) => `Document ${i}: ${d}`).join("\n\n");
  return `You are a relevance rater. Given a search query and a list of documents, output the document indices in order of relevance to the query, most relevant first.

Reply with only a JSON array of indices, no other text. Example: [2, 0, 1, 3]

Query: ${query}

Documents:
${docList}

Order (JSON array of indices):`;
}

// Use a fast, cheap model for the test
const MODEL = "openai/gpt-4o-mini";

const QUERY = "How do I reset my password?";

const DOCUMENTS = [
  "[0] To reset your password, go to Settings > Security and click 'Reset password'. You will receive an email with a link.",
  "[1] Our support team is available Monday to Friday 9am–5pm GMT. Contact support@example.com.",
  "[2] Password requirements: at least 8 characters, one number, and one special character. Avoid reusing old passwords.",
  "[3] To change your email address, open Account > Profile and update the email field. You must verify the new address.",
];

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || key.trim() === "") {
    console.error("Missing OPENROUTER_API_KEY. Set it in the environment or in .env.");
    console.error("Example: OPENROUTER_API_KEY=sk-or-... pnpm exec tsx scripts/test-openrouter-rerank-via-chat.ts");
    process.exit(1);
  }
  return key.trim();
}

async function main(): Promise<void> {
  const apiKey = getApiKey();

  const prompt = buildRerankPrompt(QUERY, DOCUMENTS);

  const body = {
    model: MODEL,
    messages: [
      {
        role: "user" as const,
        content: prompt,
      },
    ],
    max_tokens: 200,
    temperature: 0,
  };

  console.log("--- OpenRouter Chat Completions (rerank-style task) ---\n");
  console.log("Model:", MODEL);
  console.log("Query:", QUERY);
  console.log("Documents:", DOCUMENTS.length);
  console.log("\nRequest body (messages[0].content truncated):");
  console.log(JSON.stringify({ ...body, messages: [{ role: "user", content: prompt.slice(0, 200) + "..." }] }, null, 2));
  console.log("\nSending request...\n");

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.DEFAULT_REFERER || "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });

  const rawText = await response.text();

  if (!response.ok) {
    console.error("HTTP error:", response.status, response.statusText);
    console.error("Body:", rawText.slice(0, 500));
    process.exit(1);
  }

  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    console.error("Response is not JSON (e.g. HTML error page):");
    console.error(rawText.slice(0, 500));
    process.exit(1);
  }

  let data: { choices?: Array<{ message?: { content?: string } }>; usage?: unknown; error?: { message: string } };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch (e) {
    console.error("Failed to parse JSON:", e);
    console.error("Body:", rawText.slice(0, 500));
    process.exit(1);
  }

  if (data.error) {
    console.error("API error:", data.error.message);
    process.exit(1);
  }

  const content = data.choices?.[0]?.message?.content ?? "";
  console.log("Response (reranked order):");
  console.log(content);
  if (data.usage) {
    console.log("\nUsage:", JSON.stringify(data.usage, null, 2));
  }

  // Try to parse as JSON array to validate (same pattern as production for negative indices)
  const match = content.match(/\[[\s\d,-]+\]/);
  if (match) {
    try {
      const order = JSON.parse(match[0]) as number[];
      console.log("\nParsed order (indices):", order);
      console.log("Expected: most relevant first, e.g. [0, 2, 1, 3] for this query.");
    } catch {
      // ignore
    }
  }

  console.log("\nDone. OpenRouter chat completions API can be used for reranking-style tasks.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
