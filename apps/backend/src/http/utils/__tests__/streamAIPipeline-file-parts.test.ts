import { streamText } from "ai";
import { describe, expect, it, vi } from "vitest";


import { uploadConversationFile } from "../../../utils/s3";
import { createLlmObserver } from "../llmObserver";
import { pipeAIStreamToResponse } from "../streamAIPipeline";
import { createMockResponseStream } from "../streamResponseStream";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(),
  };
});

vi.mock("../../../utils/s3", () => ({
  uploadConversationFile: vi.fn(),
}));

describe("pipeAIStreamToResponse file parts", () => {
  it("uploads embedded file parts and rewrites stream output", async () => {
    const mockStreamText = vi.mocked(streamText);
    const mockUpload = vi.mocked(uploadConversationFile);

    mockUpload.mockResolvedValue({
      key: "conversation-files/workspace/agent/conversation/file.pdf",
      url: "https://s3.eu-west-2.amazonaws.com/workspace.documents/conversation-files/workspace/agent/conversation/file.pdf",
      filename: "file.pdf",
    });

    const dataUrl =
      "data:application/pdf;base64,VEVTVA=="; // "TEST"
    const ssePayload = [
      `data: ${JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          parts: [
            {
              type: "file",
              url: dataUrl,
              mediaType: "application/pdf",
              filename: "source.pdf",
            },
          ],
        },
      })}\n\n`,
      `data: ${JSON.stringify({ type: "text-delta", textDelta: "done" })}\n\n`,
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
    const observer = createLlmObserver();

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
      observer,
      {
        workspaceId: "workspace",
        agentId: "agent",
        conversationId: "conversation",
      }
    );

    const body = getBody();
    expect(body).toContain("conversation-files/workspace/agent/conversation/file.pdf");
    expect(body).not.toContain(dataUrl);

    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace",
        agentId: "agent",
        conversationId: "conversation",
        contentType: "application/pdf",
      })
    );

    const fileEvents = observer
      .getEvents()
      .filter((event) => event.type === "assistant-file");
    expect(fileEvents).toHaveLength(1);
    expect(fileEvents[0]).toEqual(
      expect.objectContaining({
        type: "assistant-file",
        fileUrl:
          "https://s3.eu-west-2.amazonaws.com/workspace.documents/conversation-files/workspace/agent/conversation/file.pdf",
        mediaType: "application/pdf",
      })
    );
  });
});
