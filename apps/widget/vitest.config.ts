import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../frontend/src"),
      "@/components": path.resolve(__dirname, "../frontend/src/components"),
      "@/hooks": path.resolve(__dirname, "../frontend/src/hooks"),
      "@/utils": path.resolve(__dirname, "../frontend/src/utils"),
    },
  },
});
