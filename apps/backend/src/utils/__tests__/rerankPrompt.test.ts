import { describe, it, expect } from "vitest";

import {
  buildRerankPrompt,
  DEFAULT_MAX_SNIPPET_CHARS,
} from "../rerankPrompt";

describe("rerankPrompt", () => {
  describe("buildRerankPrompt", () => {
    it("includes query and documents in prompt", () => {
      const query = "test query";
      const documents = ["doc one", "doc two"];
      const prompt = buildRerankPrompt(query, documents);
      expect(prompt).toContain("test query");
      expect(prompt).toContain("Document 0: doc one");
      expect(prompt).toContain("Document 1: doc two");
      expect(prompt).toContain("JSON array of indices");
      expect(prompt).toContain("Example: [2, 0, 1, 3]");
    });

    it("truncates documents over maxSnippetChars with ellipsis", () => {
      const long = "a".repeat(600);
      const prompt = buildRerankPrompt("q", [long], {
        maxSnippetChars: 100,
      });
      expect(prompt).toContain("Document 0: " + "a".repeat(97) + "...");
      expect(prompt).not.toContain("a".repeat(100));
    });

    it("uses DEFAULT_MAX_SNIPPET_CHARS when no options given", () => {
      const long = "x".repeat(DEFAULT_MAX_SNIPPET_CHARS + 100);
      const prompt = buildRerankPrompt("q", [long]);
      const truncated = "x".repeat(DEFAULT_MAX_SNIPPET_CHARS - 3) + "...";
      expect(prompt).toContain("Document 0: " + truncated);
      expect(prompt).not.toContain("x".repeat(DEFAULT_MAX_SNIPPET_CHARS + 1));
    });

    it("does not truncate short documents", () => {
      const short = "short";
      const prompt = buildRerankPrompt("q", [short], {
        maxSnippetChars: 100,
      });
      expect(prompt).toContain("Document 0: short");
    });
  });
});
