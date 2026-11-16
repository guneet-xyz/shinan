export interface Status {
  status: "ok"
}

export interface ApiClientOptions {
  /** Base URL of the Shinan server. Defaults to the current origin. */
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? ""
  const fetchImpl = options.fetch ?? globalThis.fetch

  async function get<T>(path: string): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: { accept: "application/json" },
    })
    if (!response.ok) {
      throw new ApiError(
        response.status,
        `GET ${path} failed with ${response.status}`,
      )
    }
    return (await response.json()) as T
  }

  return {
    status: () => get<Status>("/api/status"),
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
