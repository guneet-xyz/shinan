import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router"

import { createApiClient } from "@shinan/api-client"

import { ApiContext } from "./api"
import { App } from "./App"

import "./styles.css"

const root = document.getElementById("root")
if (!root) throw new Error("Missing #root element")

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <ApiContext value={createApiClient()}>
        <App />
      </ApiContext>
    </BrowserRouter>
  </StrictMode>,
)
