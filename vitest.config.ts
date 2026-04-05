import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@magick/contracts/chat": resolve("packages/contracts/src/chat.ts"),
      "@magick/contracts/provider": resolve(
        "packages/contracts/src/provider.ts",
      ),
      "@magick/contracts/ws": resolve("packages/contracts/src/ws.ts"),
      "@magick/shared/errors": resolve("packages/shared/src/errors.ts"),
      "@magick/shared/id": resolve("packages/shared/src/id.ts"),
      "@magick/shared/localWorkspace": resolve(
        "packages/shared/src/localWorkspace.ts",
      ),
      "@magick/shared/threadTitle": resolve(
        "packages/shared/src/threadTitle.ts",
      ),
      "@magick/shared/time": resolve("packages/shared/src/time.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["apps/**/*.test.ts", "apps/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["apps/server/src/**/*.ts"],
      exclude: ["apps/server/src/**/*.test.ts"],
    },
  },
});
