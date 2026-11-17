import { Link } from "react-router"

import { buttonVariants } from "@/components/ui/button"

/**
 * One answer for a page that does not exist and for something the person
 * may not see, so probing reveals nothing (identity §10).
 */
export function NotFound() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-start gap-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="text-muted-foreground">
        This page does not exist, or you do not have access to it. Check the
        address, or ask a workspace owner for an invitation.
      </p>
      <Link to="/" className={buttonVariants({ variant: "outline" })}>
        Go to the start
      </Link>
    </section>
  )
}
