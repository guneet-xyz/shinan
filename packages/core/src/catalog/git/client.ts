import { request as httpRequest } from "node:http"
import type { ClientRequest } from "node:http"
import { request as httpsRequest } from "node:https"

import type {
  CommitInfo,
  CommitRef,
  DocumentRead,
  JournalEntry,
  RepositoryFile,
  RepositoryInfo,
  RepositoryPurgePreview,
  RepositoryPurgeStatus,
  RepositoryRefs,
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
  /**
   * Opens a request to the Git container's smart HTTP paths (`/git/…`),
   * for `web`'s Git endpoint, with the service token: the caller streams
   * the body and the answer, with its own time limit (a push takes longer
   * than an API call).
   */
  smartHttp(
    pathAndQuery: string,
    input: {
      method: string
      headers: Record<string, string>
      timeoutMs: number
    },
  ): ClientRequest
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
  /**
   * With `combined`, a merge's `changes` are the paths it changed itself
   * (that differ from every parent, as Git's combined diff), not those
   * against its first parent; when they can't be known, none are listed and
   * `changeCountAtLeast` is set.
   */
  history(
    workspaceId: string,
    input: {
      commit: CommitRef
      path?: string
      limit: number
      skip?: number
      combined?: boolean
    },
  ): Promise<{ commit: string; commits: CommitInfo[] }>
  /** The journal's ID, and its entries numbered above `after`, oldest first. */
  readJournal(input: {
    after: number
    limit?: number
  }): Promise<{ journalId: string; entries: JournalEntry[]; last: number }>
  /**
   * Deletes the entries up to `through` of the journal `journalId` (refused
   * if the Git container's journal is another). Safe to repeat.
   */
  acknowledgeJournal(input: {
    journalId: string
    through: number
  }): Promise<{ deleted: number }>
  /**
   * A repository's branches and the commits they point to, unless a push to
   * it is being checked (`busy`), with the journal's last number when they
   * were read: every update applied before then is in the journal up to it.
   */
  listRefs(workspaceId: string): Promise<RepositoryRefs | null>
  /** Where a purge text is in the repository; reads only. */
  previewPurge(
    workspaceId: string,
    input: { text: string },
  ): Promise<RepositoryPurgePreview>
  /**
   * Starts removing a purge text from the repository's whole history and
   * from the journal entries not yet acknowledged (plan §2.9), as a job:
   * answers at once, `running` (refused `busy` while another purge of the
   * repository runs). Follow it with `purgeStatus`.
   */
  startPurge(
    workspaceId: string,
    input: { purgeId: string; text: string },
  ): Promise<RepositoryPurgeStatus>
  /** Where a purge stands. */
  purgeStatus(
    workspaceId: string,
    purgeId: string,
  ): Promise<RepositoryPurgeStatus>
  /**
   * Whether `text` is the text of the Git container's purge `purgeId`
   * (by its keyed hash): the only text that may finish that purge.
   */
  isPurgeText(
    workspaceId: string,
    input: { purgeId: string; text: string },
  ): Promise<boolean>
  /** Drops purge `purgeId`'s keyed hash, once `web` has recorded it. */
  forgetPurgeText(workspaceId: string, purgeId: string): Promise<void>
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
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    input: {
      query?: Record<string, string | undefined>
      body?: Json
      notFound?: true
      timeoutMs?: number
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
        signal: AbortSignal.timeout(input.timeoutMs ?? timeoutMs),
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
    smartHttp(pathAndQuery, input) {
      if (!pathAndQuery.startsWith("/git/")) {
        throw new Error("Only the Git container's /git/ paths are smart HTTP")
      }
      const url = new URL(pathAndQuery, base)
      const upstream = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          method: input.method,
          headers: {
            ...input.headers,
            authorization: `Bearer ${options.serviceToken}`,
          },
          timeout: input.timeoutMs,
        },
      )
      upstream.on("timeout", () => upstream.destroy())
      return upstream
    },
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
          combined: input.combined ? "true" : undefined,
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
      return body as unknown as {
        journalId: string
        entries: JournalEntry[]
        last: number
      }
    },
    async acknowledgeJournal(input) {
      const body = await call("POST", "/journal/acknowledge", {
        body: { journalId: input.journalId, through: input.through },
      })
      return body as { deleted: number }
    },
    async listRefs(workspaceId) {
      const body = await call("GET", repository(workspaceId, "/refs"), {
        notFound: true,
      })
      return body ? (body as unknown as RepositoryRefs) : null
    },
    async previewPurge(workspaceId, input) {
      return (await call("POST", repository(workspaceId, "/purge/preview"), {
        body: { text: input.text },
        timeoutMs: purgeTimeoutMs,
      })) as unknown as RepositoryPurgePreview
    },
    async startPurge(workspaceId, input) {
      return (await call("POST", repository(workspaceId, "/purges"), {
        body: { purgeId: input.purgeId, text: input.text },
      })) as unknown as RepositoryPurgeStatus
    },
    async purgeStatus(workspaceId, purgeId) {
      return (await call(
        "GET",
        repository(workspaceId, `/purges/${encodeURIComponent(purgeId)}`),
      )) as unknown as RepositoryPurgeStatus
    },
    async forgetPurgeText(workspaceId, purgeId) {
      await call(
        "DELETE",
        repository(workspaceId, `/purges/${encodeURIComponent(purgeId)}/text`),
      )
    },
    async isPurgeText(workspaceId, input) {
      const body = await call(
        "POST",
        repository(
          workspaceId,
          `/purges/${encodeURIComponent(input.purgeId)}/text`,
        ),
        { body: { text: input.text } },
      )
      return body?.matches === true
    },
  }
}

/**
 * How long a purge's preview may take: 10 minutes, like one Git process
 * (plan §2.10). A purge itself runs as a job, followed by `purgeStatus`.
 */
const purgeTimeoutMs = 10 * 60 * 1000
