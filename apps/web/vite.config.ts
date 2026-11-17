import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defaultClientConditions, defineConfig } from "vite"

const serverUrl = process.env.SHINAN_SERVER_URL ?? "http://127.0.0.1:3000"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
    // Bundle workspace packages from their TypeScript source.
    conditions: ["@shinan/source", ...defaultClientConditions],
  },
  server: {
    proxy: {
      "/api": serverUrl,
    },
  },
})
