import js from "@eslint/js"
import prettier from "eslint-config-prettier/flat"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"
import tseslint from "typescript-eslint"

export default defineConfig([
  globalIgnores(["**/dist/", "**/coverage/", "packages/db/migrations/"]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    // Tests are not hot-reloaded, so they may mix components and helpers.
    files: ["apps/web/src/test/**", "apps/web/src/**/*.test.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // shadcn/ui components, kept as shadcn ships them, export their style
    // helpers (such as `buttonVariants`) next to the components.
    files: ["apps/web/src/components/ui/**"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  prettier,
])
