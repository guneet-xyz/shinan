import { fileURLToPath } from "node:url"
import { defaultClientConditions, defaultServerConditions } from "vite"
import { defineConfig } from "vitest/config"

// Resolve workspace packages to their TypeScript source, so tests do not need
// a build first (see the "@shinan/source" export condition in each package).
const sourceCondition = "@shinan/source"

// Creates a fresh, migrated database for each project that has database tests.
const databaseSetup = fileURLToPath(
  new URL("./packages/db/test/global-setup.ts", import.meta.url),
)

// Server-side tests resolve packages the way Node.js does in production. Vite's
// default server conditions include "module", a bundler convention that picks
// builds Node.js cannot load (the AWS SDK's extensionless `dist-es`).
const serverConditions = defaultServerConditions.filter((c) => c !== "module")

export default defineConfig({
  resolve: { conditions: [sourceCondition, ...defaultClientConditions] },
  ssr: {
    resolve: { conditions: [sourceCondition, ...serverConditions] },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          root: "apps/server",
          globalSetup: [databaseSetup],
        },
      },
      {
        extends: true,
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
          },
        },
        test: {
          name: "web",
          root: "apps/web",
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "core",
          root: "packages/core",
          globalSetup: [databaseSetup],
        },
      },
      {
        extends: true,
        test: { name: "api-client", root: "packages/api-client" },
      },
      { extends: true, test: { name: "email", root: "packages/email" } },
      {
        extends: true,
        test: {
          name: "db",
          root: "packages/db",
          globalSetup: [databaseSetup],
        },
      },
    ],
  },
})
