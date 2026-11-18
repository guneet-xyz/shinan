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

// Timeouts (#131). Vitest's defaults, 5 s a test and 10 s a hook, fail tests
// that take a second or two when the machine runs several suites at once
// (Daedalus at a load of 12 to 18 on 2 cores). Every project gets 20 s a test
// and 60 s a hook instead. On a busier machine, SHINAN_TEST_TIMEOUT_SCALE
// multiplies them, and the web tests' wait for elements, by 1 to 10: never
// more, so a test that hangs still fails within minutes. Tests that set their
// own timeout, such as property and scale tests, keep it.
const timeScale = Math.min(
  10,
  Math.max(1, Number(process.env.SHINAN_TEST_TIMEOUT_SCALE) || 1),
)

export default defineConfig({
  resolve: { conditions: [sourceCondition, ...defaultClientConditions] },
  ssr: {
    resolve: { conditions: [sourceCondition, ...serverConditions] },
  },
  test: {
    testTimeout: 20_000 * timeScale,
    hookTimeout: 60_000 * timeScale,
    env: { SHINAN_TEST_TIMEOUT_SCALE: String(timeScale) },
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
        test: { name: "markdown", root: "packages/markdown" },
      },
      { extends: true, test: { name: "skill", root: "packages/skill" } },
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
