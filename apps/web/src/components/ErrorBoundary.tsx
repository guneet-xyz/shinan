import { Component } from "react"
import type { ReactNode } from "react"

import { Button, buttonVariants } from "@/components/ui/button"

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
      <main className="flex min-h-svh items-center justify-center p-4 sm:p-6">
        <div className="flex max-w-md flex-col items-start gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            Something went wrong
          </h1>
          <p className="text-muted-foreground">
            Shinan could not show this page. Reload it to try again.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <a href="/" className={buttonVariants({ variant: "outline" })}>
              Go to the start
            </a>
          </div>
        </div>
      </main>
    )
  }
}
