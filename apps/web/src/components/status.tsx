import { CircleAlertIcon, LoaderCircleIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"

import { errorMessage } from "../messages"

export function Loading() {
  return (
    <p
      className="flex items-center gap-2 text-sm text-muted-foreground"
      role="status"
      aria-busy="true"
    >
      <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
      Loading…
    </p>
  )
}

/** A failure the person should notice, read out as soon as it appears. */
export function ErrorAlert(props: { children: ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden="true" />
      <AlertDescription>{props.children}</AlertDescription>
    </Alert>
  )
}

export function ErrorMessage(props: { error: unknown }) {
  return <ErrorAlert>{errorMessage(props.error)}</ErrorAlert>
}

/** A confirmation that something worked, such as "Saved." */
export function Notice(props: { children: ReactNode }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {props.children}
    </p>
  )
}
