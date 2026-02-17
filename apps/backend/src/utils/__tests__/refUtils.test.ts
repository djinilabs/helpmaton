import { describe, it, expect } from "vitest";

import { idFromRef } from "../refUtils";

describe("refUtils", () => {
  describe("idFromRef", () => {
    it("strips prefix when ref starts with it", () => {
      expect(idFromRef("users/u1", "users/")).toBe("u1");
      expect(idFromRef("agents/ws-1/agent-1", "agents/")).toBe("ws-1/agent-1");
      expect(idFromRef("workspaces/ws-1", "workspaces/")).toBe("ws-1");
    });

    it("returns ref unchanged when it does not start with prefix", () => {
      expect(idFromRef("u1", "users/")).toBe("u1");
      expect(idFromRef("other/u1", "users/")).toBe("other/u1");
    });
  });
});
