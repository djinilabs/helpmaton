import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "AgentWidget",
      fileName: "widget",
      formats: ["iife"],
    },
    rollupOptions: {
      output: {
        // Ensure the bundle is self-contained
        inlineDynamicImports: true,
      },
      external: [], // Bundle everything - no externals
    },
    outDir: "../backend/public",
    emptyOutDir: false, // Don't clear the public directory
  },
  resolve: {
    alias: {
      // Map frontend imports to widget imports
      "@": path.resolve(__dirname, "../frontend/src"),
      // Also resolve relative imports from frontend
      "@/components": path.resolve(__dirname, "../frontend/src/components"),
      "@/hooks": path.resolve(__dirname, "../frontend/src/hooks"),
      "@/utils": path.resolve(__dirname, "../frontend/src/utils"),
    },
  },
});
