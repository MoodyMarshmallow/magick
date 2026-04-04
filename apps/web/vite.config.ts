import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createLocalWorkspaceDevPlugin } from "./dev/localWorkspaceDevServer";

export default defineConfig({
  plugins: [react(), createLocalWorkspaceDevPlugin()],
  server: {
    port: 4173,
    strictPort: true,
  },
});
