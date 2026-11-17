import { useId } from "react"
import type { ComponentProps, ReactNode } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** A page's main heading, with an optional line under it. */
export function PageHeader(props: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{props.title}</h1>
      {props.children && (
        <p className="text-sm text-muted-foreground">{props.children}</p>
      )}
    </div>
  )
}

/** One part of a page: a card with a heading that names the section. */
export function Section(props: {
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={props.className}>
      <Card className="max-sm:[--card-spacing:--spacing(4)]">
        <CardHeader>
          <h2 id={headingId} className="text-base font-semibold">
            {props.title}
          </h2>
          {props.description && (
            <CardDescription>{props.description}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="gap-4">{props.children}</CardContent>
      </Card>
    </section>
  )
}

const rowsClassName =
  "flex flex-col divide-y rounded-lg border [&>li]:flex [&>li]:flex-col [&>li]:gap-2 [&>li]:p-3 sm:[&>li]:p-4"

/** A list of things inside a section, one row each, on any width. */
export function Rows({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn(rowsClassName, className)} {...props} />
}

/** Like `Rows`, where the order matters, such as newest first. */
export function OrderedRows({ className, ...props }: ComponentProps<"ol">) {
  return <ol className={cn(rowsClassName, className)} {...props} />
}

/** Name and value pairs, such as a member's role and when they joined. */
export function Facts({ className, ...props }: ComponentProps<"dl">) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm [&>dd]:min-w-0 [&>dd]:wrap-anywhere [&>dt]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

/** A row of buttons that wraps on narrow screens. */
export function Actions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap gap-2", className)} {...props} />
}

/**
 * Asks before something that cannot be undone, in place, with the
 * consequences spelled out.
 */
export function Confirm({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm",
        className,
      )}
      {...props}
    />
  )
}
