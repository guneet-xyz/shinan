import { Component } from "react"
import type { ReactNode } from "react"

/** Shows a plain, generic page if rendering fails (architecture §10.2). */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: unknown) {
    console.error(error)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="page narrow">
        <h1>Something went wrong</h1>
        <p>Shinan could not show this page. Reload it to try again.</p>
        <div className="actions">
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a href="/">Go to the start</a>
        </div>
      </main>
    )
  }
}
