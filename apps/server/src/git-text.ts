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
