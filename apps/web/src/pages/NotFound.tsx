import { Link } from "react-router"

/**
 * One answer for a page that does not exist and for something the person
 * may not see, so probing reveals nothing (identity §10).
 */
export function NotFound() {
  return (
    <section className="narrow">
      <h1>Not found</h1>
      <p>
        This page does not exist, or you do not have access to it. Check the
        address, or ask a workspace owner for an invitation.
      </p>
      <p>
        <Link to="/">Go to the start</Link>
      </p>
    </section>
  )
}
