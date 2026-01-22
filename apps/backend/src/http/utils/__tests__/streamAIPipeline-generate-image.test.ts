import { streamText } from "ai";
import { describe, expect, it, vi } from "vitest";

import { pipeAIStreamToResponse } from "../streamAIPipeline";
import { createMockResponseStream } from "../streamResponseStream";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
  };
});

describe("pipeAIStreamToResponse generate_image tool results", () => {
  it("emits assistant file message for generate_image tool result", async () => {
    const mockStreamText = vi.mocked(streamText);

    const ssePayload = [
      `data: ${JSON.stringify({
        type: "tool-input-start",
        toolCallId: "call-1",
        toolName: "generate_image",
      })}\n\n`,
      `data: ${JSON.stringify({
        type: "tool-output-available",
        toolCallId: "call-1",
        output: {
          url: "https://example.com/image.png",
          contentType: "image/png",
          filename: "image.png",
        },
      })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload));
        controller.close();
      },
    });

    mockStreamText.mockReturnValue({
      toUIMessageStreamResponse: () =>
        new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        }),
    } as ReturnType<typeof streamText>);

    const { stream: responseStream, getBody } = createMockResponseStream();
    const agent = {
      pk: "agents/workspace/agent",
      systemPrompt: "",
      modelName: "test",
    } as const;

    await pipeAIStreamToResponse(
      agent,
      {} as unknown as Parameters<typeof pipeAIStreamToResponse>[1],
      [],
      {},
      responseStream,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined
    );

    const body = getBody();
    const events = body
      .split("\n\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.replace("data: ", ""))
      .filter((payload) => payload.startsWith("{"))
      .map((payload) => JSON.parse(payload) as Record<string, unknown>);

    const fileEvent = events.find((event) => event.type === "file");
    expect(fileEvent).toMatchObject({
      type: "file",
      url: "https://example.com/image.png",
      mediaType: "image/png",
    });
  });
});
