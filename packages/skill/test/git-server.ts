import { spawn } from "node:child_process"
import { createServer } from "node:http"
import type { IncomingMessage, Server, ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

/**
 * A small Git server for the setup tests: Git's own `git http-backend`
 * behind HTTP Basic authentication with one password, as Shinan's `/git/`
 * route takes the agent token. It stands in for Shinan until the push
 * checks exist (GC-3); it applies none of them.
 */
export interface TestGitServer {
  origin: string
  /** Requests that arrived with no credentials, and with the right or a wrong password. */
  requests: { none: number; right: number; wrong: number }
  close(): Promise<void>
}

export async function startGitServer(options: {
  projectRoot: string
  password: string
}): Promise<TestGitServer> {
  const requests = { none: 0, right: 0, wrong: 0 }
  const server: Server = createServer((request, response) => {
    const password = basicPassword(request.headers.authorization)
    if (password === null) requests.none++
    else if (password === options.password) requests.right++
    else requests.wrong++
    if (password !== options.password) {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="Shinan"' })
      response.end()
      return
    }
    backend(options.projectRoot, request, response)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

function basicPassword(header: string | undefined): string | null {
  const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(header ?? "")
  if (!match) return null
  const decoded = Buffer.from(match[1]!, "base64").toString("utf8")
  const colon = decoded.indexOf(":")
  return colon === -1 ? null : decoded.slice(colon + 1)
}

/** A CGI bridge to `git http-backend`. */
function backend(
  projectRoot: string,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? "/", "http://x")
  const header = (name: string) => {
    const value = request.headers[name]
    return typeof value === "string" ? value : ""
  }
  const child = spawn("git", ["http-backend"], {
    env: {
      PATH: process.env.PATH,
      GIT_PROJECT_ROOT: projectRoot,
      GIT_HTTP_EXPORT_ALL: "1",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method ?? "GET",
      CONTENT_TYPE: header("content-type"),
      ...(header("content-length")
        ? { CONTENT_LENGTH: header("content-length") }
        : {}),
      HTTP_CONTENT_ENCODING: header("content-encoding"),
      GIT_PROTOCOL: header("git-protocol"),
      REMOTE_USER: "agent",
      REMOTE_ADDR: "127.0.0.1",
    },
    stdio: ["pipe", "pipe", "inherit"],
  })
  request.pipe(child.stdin)
  let head = Buffer.alloc(0)
  let started = false
  child.stdout.on("data", (chunk: Buffer) => {
    if (started) {
      response.write(chunk)
      return
    }
    head = Buffer.concat([head, chunk])
    const end = head.indexOf("\r\n\r\n")
    if (end === -1) return
    started = true
    let status = 200
    for (const line of head.subarray(0, end).toString("latin1").split("\r\n")) {
      const colon = line.indexOf(":")
      const name = line.slice(0, colon).trim()
      const value = line.slice(colon + 1).trim()
      if (name.toLowerCase() === "status") status = Number(value.split(" ")[0])
      else response.setHeader(name, value)
    }
    response.writeHead(status)
    response.write(head.subarray(end + 4))
  })
  child.stdout.on("end", () => response.end())
}
