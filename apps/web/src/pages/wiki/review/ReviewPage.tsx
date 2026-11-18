import { useState } from "react"
import { Link, useParams } from "react-router"

import type {
  CatalogApprovalOutcome,
  CatalogProposal,
} from "@shinan/api-client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { useAccount } from "../../../account"
import { useAction } from "../../../action"
import { isApiError, useApi, useResource } from "../../../api"
import { Actions, PageHeader, Rows, Section } from "../../../components/page"
import { ErrorMessage, Loading } from "../../../components/status"
import { formatTime } from "../../../format"
import { NotFound } from "../../NotFound"
import { useWorkspace } from "../../workspace/context"
import { AreaField, NotAppliedView } from "../edit/form"
import { classNames, stateWords } from "../edit/words"
import { linkClass } from "../facts"
import { wikiPath } from "../format"
import { PageNotice } from "../notices"
import { ProposalChanges } from "./changes"
import { BulkApproval, ProposalComments } from "./review-actions"
import { hasHidden, visible } from "./visible"

/** Whether a proposal was made by one of the viewer's own agents. */
function fromYourAgent(proposal: CatalogProposal, personId: string): boolean {
  return (
    proposal.author.kind === "agent" && proposal.author.personId === personId
  )
}

function Author(props: { proposal: CatalogProposal; personId: string }) {
  const { proposal } = props
  return (
    <>
      {visible(proposal.author.label)}
      {proposal.author.kind === "agent" && " (an agent)"}
      {fromYourAgent(proposal, props.personId) && (
        <Badge variant="secondary" className="ml-2">
          from your agent
        </Badge>
      )}
      {proposal.authorStatus === "agent-disabled" && (
        <Badge variant="destructive" className="ml-2">
          agent disabled
        </Badge>
      )}
      {proposal.authorStatus === "member-left" && (
        <Badge variant="destructive" className="ml-2">
          member left
        </Badge>
      )}
    </>
  )
}

/**
 * Catalog review: waiting for approval (human experience, reviewing catalog
 * changes), oldest first. Changes that applied on their own are in Recent
 * changes.
 */
export function ReviewPage() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const { account } = useAccount()
  const waiting = useResource(`proposals-waiting:${workspace.id}`, () =>
    api.catalogProposals(workspace.id, { state: "pending", order: "oldest" }),
  )
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Catalog review">
        Changes that wait for a person's approval, oldest first. Changes that
        applied on their own are in{" "}
        <Link to={wikiPath(workspace.id, "/changes")} className={linkClass}>
          Recent changes
        </Link>
        .
      </PageHeader>
      <BulkApproval
        waiting={waiting.data?.items ?? []}
        onDone={waiting.reload}
      />
      <Section title="Waiting for approval">
        {waiting.error ? <ErrorMessage error={waiting.error} /> : null}
        {!waiting.data && !waiting.error && <Loading />}
        {waiting.data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting for approval.
          </p>
        )}
        {waiting.data && waiting.data.items.length > 0 && (
          <Rows>
            {waiting.data.items.map((p) => (
              <li key={p.id}>
                <p className="text-sm">
                  <Link
                    to={wikiPath(workspace.id, `/proposals/${p.id}`)}
                    className={linkClass}
                  >
                    Catalog proposal {p.number}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    · {formatTime(p.createdAt)} ·{" "}
                    <Author proposal={p} personId={account.person.id} />
                  </span>
                </p>
                <p className="font-mono text-xs wrap-anywhere text-muted-foreground">
                  {visible(p.touches.join(", "))}
                </p>
                <ul className="list-disc pl-5 text-sm">
                  {p.approvalReasons.map((r, i) => (
                    <li key={i}>{visible(r)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </Rows>
        )}
      </Section>
    </div>
  )
}

/** One catalog proposal: what it changes and why, and what to do with it. */
export function ProposalPage() {
  const api = useApi()
  const { workspace } = useWorkspace()
  const proposalId = useParams().proposalId!
  const proposal = useResource(`proposal:${workspace.id}:${proposalId}`, () =>
    api.catalogProposal(workspace.id, proposalId),
  )
  const members = useResource(`members:${workspace.id}`, () =>
    api.members(workspace.id),
  )
  if (proposal.error) {
    if (isApiError(proposal.error, "not-found")) return <NotFound />
    return <ErrorMessage error={proposal.error} />
  }
  if (!proposal.data) return <Loading />
  return (
    <ProposalView
      proposal={proposal.data}
      members={members.data?.length}
      reload={proposal.reload}
    />
  )
}

function ProposalView(props: {
  proposal: CatalogProposal
  members: number | undefined
  reload: () => void
}) {
  const { proposal } = props
  const { workspace } = useWorkspace()
  const { account } = useAccount()
  const me = account.person.id
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Catalog proposal ${proposal.number}`}>
        {stateWords[proposal.state]} ·{" "}
        <Link to={wikiPath(workspace.id, "/review")} className={linkClass}>
          Catalog review
        </Link>
      </PageHeader>
      {hasHidden(
        [
          proposal.explanation,
          proposal.relatedTask ?? "",
          proposal.author.label,
          JSON.stringify(proposal.operations),
        ].join("\n"),
      ) && (
        <PageNotice warning>
          <p className="font-semibold">
            This proposal holds characters that cannot be seen.
          </p>
          <p>
            They are shown below as markers such as ⟨U+202E⟩. Hidden text can
            disguise what a change says, or carry words agents read but people
            do not; approve only if you know why they are there.
          </p>
        </PageNotice>
      )}
      <Section title="About it">
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm [&>dd]:min-w-0 [&>dd]:wrap-anywhere [&>dt]:text-muted-foreground">
          <dt>State</dt>
          <dd>
            <Badge
              variant={proposal.state === "pending" ? "default" : "secondary"}
            >
              {stateWords[proposal.state]}
            </Badge>
          </dd>
          <dt>By</dt>
          <dd>
            <Author proposal={proposal} personId={me} />
          </dd>
          <dt>Made</dt>
          <dd>{formatTime(proposal.createdAt)}</dd>
          <dt>Based on</dt>
          <dd>revision {proposal.basedOnRevision}</dd>
          {proposal.relatedTask && (
            <>
              <dt>Related task</dt>
              <dd className="font-mono">{visible(proposal.relatedTask)}</dd>
            </>
          )}
          {proposal.appliedRevision !== null && (
            <>
              <dt>Applied</dt>
              <dd>
                as revision {proposal.appliedRevision}
                {proposal.decidedBy && `, by ${proposal.decidedBy}`}
              </dd>
            </>
          )}
          {proposal.state === "rejected" && (
            <>
              <dt>Rejected</dt>
              <dd>
                by {visible(proposal.decidedBy ?? "")}:{" "}
                {visible(proposal.rejectionReason ?? "")}
              </dd>
            </>
          )}
          {proposal.state === "withdrawn" && (
            <>
              <dt>Withdrawn</dt>
              <dd>by {proposal.decidedBy}</dd>
            </>
          )}
          {proposal.revertsProposalId && (
            <>
              <dt>Reverts</dt>
              <dd>
                <Link
                  to={wikiPath(
                    workspace.id,
                    `/proposals/${proposal.revertsProposalId}`,
                  )}
                  className={linkClass}
                >
                  the proposal it undoes
                </Link>
              </dd>
            </>
          )}
          <dt>Kind of change</dt>
          <dd>{proposal.approvalClasses.map(classNames).join(", ")}</dd>
        </dl>
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground">Why:</p>
          <p className="wrap-anywhere whitespace-pre-wrap">
            {visible(proposal.explanation)}
          </p>
        </div>
        {proposal.approvalReasons.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <p className="text-muted-foreground">Needs approval because:</p>
            <ul className="list-disc pl-5">
              {proposal.approvalReasons.map((r, i) => (
                <li key={i}>{visible(r)}</li>
              ))}
            </ul>
          </div>
        )}
        {proposal.warnings.length > 0 && (
          <PageNotice warning>
            <p className="font-semibold">Validation's warnings:</p>
            <ul className="list-disc pl-5">
              {proposal.warnings.map((w, i) => (
                <li key={i} className="wrap-anywhere">
                  {visible(w.message)}
                </li>
              ))}
            </ul>
          </PageNotice>
        )}
      </Section>
      <Section
        title="What it changes"
        description="Each fact before and after, with the fact check that is its evidence."
      >
        <ProposalChanges
          workspaceId={workspace.id}
          operations={proposal.operations}
        />
      </Section>
      <ProposalComments proposal={proposal} />
      {proposal.state === "pending" && (
        <Decide
          proposal={proposal}
          members={props.members}
          reload={props.reload}
        />
      )}
    </div>
  )
}

/** Approve, Reject with a reason, or (for its author) Withdraw. */
function Decide(props: {
  proposal: CatalogProposal
  members: number | undefined
  reload: () => void
}) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const { account } = useAccount()
  const { proposal } = props
  const me = account.person.id
  const own = fromYourAgent(proposal, me)
  const author = proposal.author.personId === me
  // While one person uses Shinan they may approve their own agents'
  // proposals (O-46); with more, another member approves (M2-Q8).
  const mayApprove = !own || props.members === 1
  const [reason, setReason] = useState("")
  const [outcome, setOutcome] = useState<CatalogApprovalOutcome>()
  const approving = useAction()
  const rejecting = useAction()
  const withdrawing = useAction()

  return (
    <Section title="Decide">
      {proposal.authorStatus !== undefined &&
        proposal.authorStatus !== "current" && (
          <PageNotice warning>
            <p>
              {proposal.authorStatus === "agent-disabled"
                ? "The agent that made this proposal has since been disabled."
                : "The member who made this proposal, or whose agent did, has left the workspace."}{" "}
              Look at it the harder for that, or reject it.
            </p>
          </PageNotice>
        )}
      {own && !mayApprove && (
        <p className="text-sm text-muted-foreground">
          This is from your agent: another member approves it, since this
          workspace has more than one.
        </p>
      )}
      {mayApprove && (
        <Actions>
          <Button
            type="button"
            disabled={approving.pending}
            onClick={() =>
              approving.run(async () => {
                const result = await api.approveCatalogProposal(
                  workspace.id,
                  proposal.id,
                )
                setOutcome(result)
                if (result.outcome === "applied") props.reload()
              })
            }
          >
            Approve
          </Button>
        </Actions>
      )}
      {outcome && !("proposal" in outcome) && (
        <>
          <p className="text-sm">
            It was not applied, and still waits: the catalog changed since it
            was made.
          </p>
          <NotAppliedView outcome={outcome} />
        </>
      )}
      {approving.error !== undefined && (
        <ErrorMessage error={approving.error} />
      )}
      <AreaField
        label="Reason to reject it"
        value={reason}
        onChange={setReason}
        description="Its author sees this."
      />
      <Actions>
        <Button
          type="button"
          variant="destructive"
          disabled={reason.trim() === "" || rejecting.pending}
          onClick={() =>
            rejecting.run(
              () =>
                api.rejectCatalogProposal(workspace.id, proposal.id, reason),
              props.reload,
            )
          }
        >
          Reject
        </Button>
        {author && (
          <Button
            type="button"
            variant="outline"
            disabled={withdrawing.pending}
            onClick={() =>
              withdrawing.run(
                () => api.withdrawCatalogProposal(workspace.id, proposal.id),
                props.reload,
              )
            }
          >
            Withdraw
          </Button>
        )}
      </Actions>
      {rejecting.error !== undefined && (
        <ErrorMessage error={rejecting.error} />
      )}
      {withdrawing.error !== undefined && (
        <ErrorMessage error={withdrawing.error} />
      )}
    </Section>
  )
}
