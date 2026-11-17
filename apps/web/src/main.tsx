import { CSPProvider } from "@base-ui/react/csp-provider"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"

import { createApiClient } from "@shinan/api-client"

import { ApiContext } from "./api"
import { App } from "./App"

import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root element")

// Base UI's inline <style> tags would be refused by the Content Security
// Policy; index.css carries their rules instead.
createRoot(root).render(
  <StrictMode>
    <CSPProvider disableStyleElements>
      <BrowserRouter>
        <ApiContext value={createApiClient()}>
          <App />
        </ApiContext>
      </BrowserRouter>
    </CSPProvider>
  </StrictMode>,
)
