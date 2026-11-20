import type {
  CommitInfo,
  CommitRef,
  DocumentRead,
  JournalEntry,
  RepositoryFile,
  RepositoryInfo,
  TreeChange,
  TreeEntry,
} from "./api.js"

/**
 * A refusal or failure from the Git container: its HTTP status and error
 * code, never a body it did not mean as an answer.
 */
export class GitServiceError extends Error {
  override name = "GitServiceError"
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export interface GitClientOptions {
  /** The Git container's internal address (`SHINAN_GIT_URL`), such as `http://git:3000`. */
  url: string
  /** The service token (`SHINAN_GIT_SERVICE_TOKEN`). */
  serviceToken: string
  /** How long one request may take. Default 60 seconds. */
  timeoutMs?: number
  fetch?: typeof fetch
}

/**
 * The typed client of the Git container's API, for `web`, `worker` and
 * `migrate` (Git-based catalog plan §2.2). Calls go one way: they ask, the
 * Git container answers and calls nobody.
 */
export interface GitClient {
  /** The repository's `main`, or `null` if the workspace has none. */
  getRepository(workspaceId: string): Promise<RepositoryInfo | null>
  /**
   * Creates the workspace's repository with one first commit holding
   * `files`, by Shinan, unless it exists. Safe to repeat.
   */
  createRepository(
    workspaceId: string,
    input: { files: RepositoryFile[]; message: string },
  ): Promise<RepositoryInfo & { created: boolean }>
  listTree(
    workspaceId: string,
    input: { commit: CommitRef; path?: string; recursive?: boolean },
  ): Promise<{ commit: string; entries: TreeEntry[]; truncated: boolean }>
  readDocuments(
    workspaceId: string,
    input: { commit: CommitRef; paths: string[] },
  ): Promise<{ commit: string; documents: DocumentRead[] }>
  /** `from` `null` compares with the empty tree. */
  diff(
    workspaceId: string,
    input: { from: string | null; to: CommitRef },
  ): Promise<{
    from: string | null
    to: string
    changes: TreeChange[]
    truncated: boolean
  }>
  history(
    workspaceId: string,
    input: { commit: CommitRef; path?: string; limit: number; skip?: number },
  ): Promise<{ commit: string; commits: CommitInfo[] }>
  /** Journal entries numbered above `after`, oldest first. */
  readJournal(input: { after: number; limit?: number }): Promise<JournalEntry[]>
  /** Deletes the entries up to `through`. Safe to repeat. */
  acknowledgeJournal(through: number): Promise<{ deleted: number }>
}

type Json = Record<string, unknown>

const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"))

export function createGitClient(options: GitClientOptions): GitClient {
  const base = new URL(options.url)
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("The Git container's address must be http or https")
  }
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000

  async function call(
    method: "GET" | "POST" | "PUT",
    path: string,
    input: {
      query?: Record<string, string | undefined>
      body?: Json
      notFound?: true
    } = {},
  ): Promise<Json | null> {
    const url = new URL(path, base)
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value)
    }
    let response: Response
    try {
      response = await doFetch(url, {
        method,
        headers: {
          authorization: `Bearer ${options.serviceToken}`,
          ...(input.body ? { "content-type": "application/json" } : {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new GitServiceError(
        0,
        "unreachable",
        "The Git container did not answer",
        {
          cause: error,
        },
      )
    }
    const body = (await response.json().catch(() => null)) as Json | null
    if (response.status === 404 && input.notFound) return null
    if (!response.ok || !body) {
      const code = typeof body?.error === "string" ? body.error : "failed"
      const message =
        typeof body?.message === "string"
          ? body.message
          : `The Git container answered ${response.status}`
      throw new GitServiceError(response.status, code, message)
    }
    return body
  }

  const repository = (workspaceId: string, rest = "") =>
    `/repositories/${encodeURIComponent(workspaceId)}${rest}`

  return {
    async getRepository(workspaceId) {
      const body = await call("GET", repository(workspaceId), {
        notFound: true,
      })
      return body ? (body as unknown as RepositoryInfo) : null
    },
    async createRepository(workspaceId, input) {
      const body = await call("PUT", repository(workspaceId), {
        body: {
          message: input.message,
          files: input.files.map((f) => ({
            path: f.path,
            content: Buffer.from(f.content).toString("base64"),
          })),
        },
      })
      return body as unknown as RepositoryInfo & { created: boolean }
    },
    async listTree(workspaceId, input) {
      return (await call("GET", repository(workspaceId, "/tree"), {
        query: {
          commit: input.commit,
          path: input.path,
          recursive: input.recursive === false ? "false" : undefined,
        },
      })) as unknown as {
        commit: string
        entries: TreeEntry[]
        truncated: boolean
      }
    },
    async readDocuments(workspaceId, input) {
      const body = (await call("POST", repository(workspaceId, "/documents"), {
        body: { commit: input.commit, paths: input.paths },
      })) as { commit: string; documents: Json[] }
      return {
        commit: body.commit,
        documents: body.documents.map((d) =>
          typeof d.content === "string"
            ? ({ ...d, content: bytes(d.content) } as DocumentRead)
            : (d as unknown as DocumentRead),
        ),
      }
    },
    async diff(workspaceId, input) {
      return (await call("GET", repository(workspaceId, "/diff"), {
        query: { from: input.from ?? undefined, to: input.to },
      })) as unknown as {
        from: string | null
        to: string
        changes: TreeChange[]
        truncated: boolean
      }
    },
    async history(workspaceId, input) {
      return (await call("GET", repository(workspaceId, "/history"), {
        query: {
          commit: input.commit,
          path: input.path,
          limit: String(input.limit),
          skip: input.skip ? String(input.skip) : undefined,
        },
      })) as unknown as { commit: string; commits: CommitInfo[] }
    },
    async readJournal(input) {
      const body = await call("GET", "/journal", {
        query: {
          after: String(input.after),
          limit: input.limit === undefined ? undefined : String(input.limit),
        },
      })
      return (body as { entries: JournalEntry[] }).entries
    },
    async acknowledgeJournal(through) {
      return (await call("POST", "/journal/acknowledge", {
        body: { through },
      })) as unknown as { deleted: number }
    },
  }
}
