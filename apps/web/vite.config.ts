import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createLocalWorkspaceDevPlugin } from "./dev/localWorkspaceDevServer";

export default defineConfig({
  plugins: [react(), createLocalWorkspaceDevPlugin()],
  resolve: {
    alias: {
      "@magick/shared/localWorkspace": resolve(
        __dirname,
        "../../packages/shared/src/localWorkspace.ts",
      ),
      "@magick/shared/localWorkspaceNode": resolve(
        __dirname,
        "../../packages/shared/src/localWorkspaceNode.ts",
      ),
      "@magick/shared/threadTitle": resolve(
        __dirname,
        "../../packages/shared/src/threadTitle.ts",
      ),
    },
  },
  server: {
    port: 4173,
    strictPort: true,
  },
});
