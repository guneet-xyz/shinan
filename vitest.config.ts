import { defaultClientConditions, defaultServerConditions } from "vite"
import { defineConfig } from "vitest/config"

// Resolve workspace packages to their TypeScript source, so tests do not need
// a build first (see the "@shinan/source" export condition in each package).
const sourceCondition = "@shinan/source"

export default defineConfig({
  resolve: { conditions: [sourceCondition, ...defaultClientConditions] },
  ssr: {
    resolve: { conditions: [sourceCondition, ...defaultServerConditions] },
  },
  test: {
    projects: [
      { extends: true, test: { name: "server", root: "apps/server" } },
      { extends: true, test: { name: "web", root: "apps/web" } },
      { extends: true, test: { name: "core", root: "packages/core" } },
      {
        extends: true,
        test: { name: "api-client", root: "packages/api-client" },
      },
      {
        extends: true,
        test: {
          name: "db",
          root: "packages/db",
          globalSetup: ["./test/global-setup.ts"],
        },
      },
    ],
  },
})
