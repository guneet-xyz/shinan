import { useEffect, useState } from "react"

import { createApiClient } from "@shinan/api-client"

const api = createApiClient()

export function App() {
  const [status, setStatus] = useState("checking…")

  useEffect(() => {
    api.status().then(
      (result) => setStatus(result.status),
      () => setStatus("unreachable"),
    )
  }, [])

  return (
    <main>
      <h1>Shinan</h1>
      <p>Server status: {status}</p>
    </main>
  )
}
