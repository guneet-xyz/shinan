import { errorMessage } from "../messages"

export function Loading() {
  return (
    <p className="muted" role="status" aria-busy="true">
      Loading…
    </p>
  )
}

export function ErrorMessage(props: { error: unknown }) {
  return (
    <p className="error" role="alert">
      {errorMessage(props.error)}
    </p>
  )
}
