/**
 * A Git-friendly answer to a fetch or push: plain text, which Git shows to
 * the person or agent running it as `remote: …` (for the first request of
 * a fetch or push; later ones only show the status). Shinan's own words,
 * never what the request sent.
 */
export function gitText(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(`${message}\n`, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  })
}

/** "1 second", "2 seconds". */
export function count(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`
}

/**
 * Every text the Git endpoint and the Git container show through a `git`
 * client, in one voice (product review of GC-2, D-067): each starts with
 * `Shinan: `, so an agent tells Shinan's words from Git's, and ends with a
 * full stop; each says what happened and what to do, in under about 120
 * characters (Git prefixes `remote: ` and does not wrap).
 */
export const gitMessages = {
  /** No catalog for this token here: an unknown workspace and another workspace's token read the same. */
  notFound:
    "Shinan: no catalog here for this agent's token. Check the clone address and the token's workspace in Shinan.",
  /** Not one of the four smart HTTP requests. */
  noSuchPath:
    "Shinan: no catalog at this address. Check the clone address in Shinan.",
  noToken:
    'Shinan: no agent token was sent. Set up Git\'s credential helper as the "Set up an agent" page shows.',
  invalidToken:
    "Shinan: this agent's token was not accepted (revoked or replaced). Tell your person; they can make a new one.",
  tokenInAddress:
    "Shinan: never put the token in the address. Remove it from the remote URL and tell your person to replace it.",
  cookie: "Shinan: agent requests take only an agent token; send no cookies.",
  readOnly:
    "Shinan: this agent's token is read-only, so it can't push. Nothing was changed. Ask your person for one that can.",
  noReadScope:
    "Shinan: this agent's token can't read the catalog. Ask your person for one that can.",
  forbidden:
    "Shinan: this agent can't use this catalog. Ask your person to check the agent in Shinan.",
  pushRate: (max: number, minutes: number, seconds: number) =>
    `Shinan: too many pushes (at most ${max} in ${count(minutes, "minute")}). Nothing was changed; try again in ${count(seconds, "second")}.`,
  rate: (seconds: number) =>
    `Shinan: too many requests. Try again in ${count(seconds, "second")}.`,
  inFlight:
    "Shinan: too many requests at once. Try again in a moment, one at a time.",
  pushTooLarge: (mib: number) =>
    `Shinan: this push is over the ${mib} MiB limit. Nothing was changed; push fewer changes at once.`,
  fetchTooLarge: (mib: number) =>
    `Shinan: this fetch is over the ${mib} MiB limit. Fetch only main (git fetch origin main) or clone again.`,
  notSetUp:
    "Shinan: the Git service is not set up on this installation. Tell its operator.",
  unreachable:
    "Shinan: the Git service did not answer. Try again in a few seconds.",
  gitFailed:
    "Shinan: the Git service could not answer. Try again in a few seconds.",
  busy: "Shinan: the Git service is busy with other fetches and pushes. Try again in 10 seconds.",
  agentBusy: (processes: number, seconds: number) =>
    `Shinan: this agent already has ${processes} ${processes === 1 ? "fetch or push" : "fetches or pushes"} running. Try again in ${count(seconds, "second")}, one at a time.`,
  // Only a broken or unusual client, or a bug between web and the Git
  // container, reaches these.
  badLength: "Shinan: the Content-Length is not a number.",
  badEncoding: "Shinan: Git requests are sent uncompressed or with gzip.",
  badProtocol: "Shinan: the Git-Protocol header is not one Git sends.",
  badGzip: "Shinan: the request body is not valid gzip.",
  bodyCutShort: "Shinan: the request body did not arrive whole. Try again.",
  noContext: "Shinan: the request has no context.",
  otherContext: "Shinan: the context is for another workspace.",
} as const
