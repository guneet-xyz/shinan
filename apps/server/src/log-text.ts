/**
 * Text from a library's message, made safe to print: only the part before
 * the first `:` (libraries put request values after it, such as "Invalid
 * callbackURL: …"), with control characters replaced, so nobody can write
 * a line of their own into the log. Capped at 100 characters.
 */
export function safeLogText(message: unknown): string {
  const head = String(message).split(":", 1)[0] ?? ""
  return Array.from(head, (char) => {
    const code = char.codePointAt(0)!
    return code < 0x20 || (code >= 0x7f && code < 0xa0) ? "?" : char
  })
    .join("")
    .slice(0, 100)
}
