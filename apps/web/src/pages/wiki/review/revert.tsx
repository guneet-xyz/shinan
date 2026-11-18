import { useState } from "react"
import { Link } from "react-router"

import type {
  CatalogProposalOutcome,
  RecentCatalogChange,
} from "@shinan/api-client"

import { Button } from "@/components/ui/button"

import { useAction } from "../../../action"
import { useApi } from "../../../api"
import { Actions, Confirm } from "../../../components/page"
import { ErrorMessage } from "../../../components/status"
import { useWorkspace } from "../../workspace/context"
import { NotAppliedView, TextField } from "../edit/form"
import { stateWords } from "../edit/words"
import { linkClass } from "../facts"
import { wikiPath } from "../format"

/**
 * Revert (human experience, reviewing catalog changes; catalog §8.2): one
 * action that makes a new proposal putting back what the change replaced.
 * It is offered while every document the change wrote is still as it left
 * it; a revert is itself a proposal, so it applies or waits like any other.
 */
export function RevertAction(props: {
  change: RecentCatalogChange
  onReverted: () => void
}) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const { change } = props
  const [confirming, setConfirming] = useState(false)
  const [explanation, setExplanation] = useState("")
  const [outcome, setOutcome] = useState<CatalogProposalOutcome>()
  // One key per revert asked for, so a double click makes one proposal.
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const reverting = useAction()

  if (change.revertedBy)
    return (
      <p className="text-sm text-muted-foreground">
        Reverted by{" "}
        <Link
          to={wikiPath(workspace.id, `/proposals/${change.revertedBy.id}`)}
          className={linkClass}
        >
          catalog proposal {change.revertedBy.number}
        </Link>{" "}
        ({stateWords[change.revertedBy.state]}).
      </p>
    )
  if (outcome && "proposal" in outcome)
    return (
      <p role="status" className="text-sm">
        Reverted as{" "}
        <Link
          to={wikiPath(workspace.id, `/proposals/${outcome.proposal.id}`)}
          className={linkClass}
        >
          catalog proposal {outcome.proposal.number}
        </Link>
        {outcome.outcome === "pending"
          ? ", waiting for catalog approval."
          : "."}
      </p>
    )
  if (!change.revertible)
    return (
      <p className="text-sm text-muted-foreground">
        It cannot be reverted in one step: a later change wrote the same
        documents.
      </p>
    )
  if (!confirming)
    return (
      <Actions>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
          aria-label={`Revert catalog proposal ${change.proposal.number}`}
        >
          Revert
        </Button>
      </Actions>
    )
  return (
    <Confirm>
      <p>
        This makes a new catalog proposal that puts back every document catalog
        proposal {change.proposal.number} changed, as it was before. Like any
        change, it may wait for approval.
      </p>
      <TextField
        label="Why (optional)"
        value={explanation}
        onChange={setExplanation}
      />
      <Actions>
        <Button
          type="button"
          variant="destructive"
          disabled={reverting.pending}
          onClick={() =>
            reverting.run(async () => {
              const answer = await api.revertCatalogProposal(
                workspace.id,
                change.proposal.id,
                {
                  ...(explanation.trim()
                    ? { explanation: explanation.trim() }
                    : {}),
                  idempotencyKey,
                },
              )
              setOutcome(answer)
              if ("proposal" in answer) props.onReverted()
            })
          }
        >
          Revert catalog proposal {change.proposal.number}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setConfirming(false)
            reverting.clear()
          }}
        >
          Cancel
        </Button>
      </Actions>
      {reverting.error !== undefined && (
        <ErrorMessage error={reverting.error} />
      )}
      {outcome && !("proposal" in outcome) && (
        <NotAppliedView outcome={outcome} />
      )}
    </Confirm>
  )
}
