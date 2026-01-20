import { describe, expect, it } from "vitest";

import {
  buildSlackChannelHistoryMessages,
  buildSlackThreadHistoryMessages,
} from "../slackTask";

describe("slackTask history helpers", () => {
  it("builds thread history without current or empty messages", () => {
    const messages = [
      { ts: "1", text: "Old message", user: "U1" },
      { ts: "2", text: "", user: "U2" },
      { ts: "3", text: "Bot reply", bot_id: "B1" },
      { ts: "4", text: "Current message", user: "U3" },
    ];

    const result = buildSlackThreadHistoryMessages({
      messages,
      safeMessageTs: "4",
      messageHistoryCount: 2,
      botUserId: "UBOT",
    });

    expect(result).toEqual([
      { role: "user", content: "Old message" },
      { role: "assistant", content: "Bot reply" },
    ]);
  });

  it("builds channel history in chronological order", () => {
    const messages = [
      { ts: "10", text: "Current", user: "U1" },
      { ts: "9", text: "Thread reply", user: "U2", thread_ts: "8" },
      { ts: "8", text: "Top level", user: "U3", thread_ts: "8" },
      { ts: "7", text: "Bot top level", bot_id: "B1" },
      { ts: "6", text: "", user: "U4" },
    ];

    const result = buildSlackChannelHistoryMessages({
      messages,
      safeMessageTs: "10",
      messageHistoryCount: 2,
      botUserId: "UBOT",
    });

    expect(result).toEqual([
      { role: "assistant", content: "Bot top level" },
      { role: "user", content: "Top level" },
    ]);
  });
});
