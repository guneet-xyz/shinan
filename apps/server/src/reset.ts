/**
 * Closes a connection with a reset, which drops what the other side has
 * not read yet, rather than delivering it first.
 */
export function resetConnection(
  outgoing: { destroy(): void; socket?: unknown } | undefined,
): void {
  const socket = outgoing?.socket as
    { resetAndDestroy?: () => void; destroyed?: boolean } | null | undefined
  if (
    socket &&
    !socket.destroyed &&
    typeof socket.resetAndDestroy === "function"
  )
    socket.resetAndDestroy()
  outgoing?.destroy()
}
