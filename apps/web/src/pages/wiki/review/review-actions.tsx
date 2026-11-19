import { useState } from "react"
import { Link } from "react-router"

import type {
  CatalogBulkApprovalResult,
  CatalogBulkRejectionResult,
  CatalogBulkSelection,
  CatalogProposal,
  CatalogProposalComment,
} from "@shinan/api-client"

import { Button } from "@/components/ui/button"

import { useAccount } from "../../../account"
import { useAction } from "../../../action"
import { useApi, useResource } from "../../../api"
import { Actions, Rows, Section } from "../../../components/page"
import { ErrorMessage, Loading } from "../../../components/status"
import { formatTime } from "../../../format"
import { useWorkspace } from "../../workspace/context"
import { AreaField, CheckboxField } from "../edit/form"
import { linkClass } from "../facts"
import { wikiPath } from "../format"
import { PageNotice } from "../notices"
import { visible } from "./visible"

/**
 * Comments on a proposal (catalog §8.6): from members, and from agents
 * asked to review it, which inform the person without letting an agent
 * approve. Oldest first, a page at a time; anyone who may propose comments.
 * Agents' text is shown with its hidden characters marked, like the rest
 * of a proposal.
 */
export function ProposalComments(props: { proposal: CatalogProposal }) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const [pages, setPages] = useState<(string | null)[]>([null])
  const [text, setText] = useState("")
  // One key per comment written, so a double click posts it once.
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  )
  const comments = useResource(
    `proposal-comments:${workspace.id}:${props.proposal.id}:${pages.length}`,
    async () => {
      const items: CatalogProposalComment[] = []
      let next: string | null = null
      let total = 0
      for (const cursor of pages) {
        const page = await api.catalogProposalComments(
          workspace.id,
          props.proposal.id,
          cursor === null ? {} : { cursor },
        )
        items.push(...page.items)
        next = page.nextCursor
        total = page.total
      }
      return { items, next, total }
    },
  )
  const posting = useAction()

  const post = () =>
    posting.run(
      () =>
        api.commentOnCatalogProposal(
          workspace.id,
          props.proposal.id,
          text.trim(),
          idempotencyKey,
        ),
      () => {
        setText("")
        setIdempotencyKey(crypto.randomUUID())
        comments.reload()
      },
    )

  return (
    <Section
      title="Comments"
      description="From members, and from agents asked to review it. Only people approve."
    >
      {comments.error ? <ErrorMessage error={comments.error} /> : null}
      {!comments.data && !comments.error && <Loading />}
      {comments.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      )}
      {comments.data && comments.data.items.length > 0 && (
        <Rows aria-label="Comments">
          {comments.data.items.map((c) => (
            <li key={c.id}>
              <p className="text-sm">
                <span className="font-medium">{visible(c.author.label)}</span>
                {c.author.kind === "agent" && (
                  <span className="text-muted-foreground"> (an agent)</span>
                )}{" "}
                <span className="text-muted-foreground">
                  · {formatTime(c.createdAt)}
                </span>
              </p>
              <p className="text-sm wrap-anywhere whitespace-pre-wrap">
                {visible(c.text)}
              </p>
            </li>
          ))}
        </Rows>
      )}
      {comments.data?.next && (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setPages((p) => [...p, comments.data!.next])}
        >
          Older comments ({comments.data.total - comments.data.items.length}{" "}
          more)
        </Button>
      )}
      <AreaField label="Add a comment" value={text} onChange={setText} />
      <Actions>
        <Button
          type="button"
          disabled={text.trim() === "" || posting.pending}
          onClick={post}
        >
          Comment
        </Button>
      </Actions>
      {posting.error !== undefined && <ErrorMessage error={posting.error} />}
    </Section>
  )
}

/**
 * Approving or rejecting several waiting proposals at once, while the
 * strict setting is on (catalog §8.2; human experience, reviewing catalog
 * changes): the ones chosen, or all of a task's proposals that were shown.
 * Each is decided on its own, so one that no longer applies is reported
 * and the rest go ahead.
 */
export function BulkApproval(props: {
  waiting: readonly CatalogProposal[]
  onDone: () => void
}) {
  const api = useApi()
  const { workspace } = useWorkspace()
  const { account } = useAccount()
  const settings = useResource(`catalog-settings:${workspace.id}`, () =>
    api.catalogSettings(workspace.id),
  )
  const members = useResource(`members:${workspace.id}`, () =>
    api.members(workspace.id),
  )
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [reason, setReason] = useState("")
  const [results, setResults] =
    useState<(CatalogBulkApprovalResult | CatalogBulkRejectionResult)[]>()
  const acting = useAction()
  if (!settings.data?.strict || props.waiting.length === 0) return null

  // Your own agents' proposals are approved by another member once the
  // workspace has more than one (M2-Q8); a task whose proposals are all
  // yours to leave is not offered for approval.
  const approvable = (p: CatalogProposal) =>
    !(
      p.author.kind === "agent" &&
      p.author.personId === account.person.id &&
      (members.data?.length ?? 2) > 1
    )
  const tasks = new Map<string, { seenUpTo: number; approvable: boolean }>()
  for (const p of props.waiting)
    if (p.relatedTask) {
      const was = tasks.get(p.relatedTask)
      tasks.set(p.relatedTask, {
        seenUpTo: Math.max(was?.seenUpTo ?? 0, p.number),
        approvable: (was?.approvable ?? false) || approvable(p),
      })
    }
  const approve = (selection: CatalogBulkSelection) =>
    acting.run(async () => {
      const answer = await api.bulkApproveCatalogProposals(
        workspace.id,
        selection,
      )
      setResults(answer.results)
      setChosen(new Set())
      props.onDone()
    })
  const reject = () =>
    acting.run(async () => {
      const answer = await api.bulkRejectCatalogProposals(
        workspace.id,
        { proposalIds: [...chosen] },
        reason.trim(),
      )
      setResults(answer.results)
      setChosen(new Set())
      setReason("")
      props.onDone()
    })

  return (
    <Section
      title="Approve or reject several"
      description="The strict setting is on, so every change waits; decide several at once. Each is checked again as it applies."
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">
          Proposals to decide
        </legend>
        {props.waiting.map((p) => (
          <CheckboxField
            key={p.id}
            label={`Catalog proposal ${p.number}: ${visible(p.touches.join(", "))}, by ${visible(p.author.label)}${p.author.kind === "agent" ? " (an agent)" : ""}${approvable(p) ? "" : "; your agent's, so another member approves it"}`}
            checked={chosen.has(p.id)}
            onChange={(on) =>
              setChosen((set) => {
                const next = new Set(set)
                if (on) next.add(p.id)
                else next.delete(p.id)
                return next
              })
            }
          />
        ))}
      </fieldset>
      <Actions>
        <Button
          type="button"
          disabled={chosen.size === 0 || acting.pending}
          onClick={() => approve({ proposalIds: [...chosen] })}
        >
          Approve{" "}
          {chosen.size === 1 ? "1 proposal" : `${chosen.size} proposals`}
        </Button>
        {[...tasks]
          .filter(([, t]) => t.approvable)
          .map(([task, { seenUpTo }]) => (
            <Button
              key={task}
              type="button"
              variant="outline"
              disabled={acting.pending}
              onClick={() => approve({ relatedTask: task, seenUpTo })}
            >
              Approve all of {visible(task)}
            </Button>
          ))}
      </Actions>
      <AreaField
        label="Reason to reject the chosen ones"
        value={reason}
        onChange={setReason}
        description="Their authors see this."
      />
      <Actions>
        <Button
          type="button"
          variant="destructive"
          disabled={chosen.size === 0 || reason.trim() === "" || acting.pending}
          onClick={reject}
        >
          Reject {chosen.size === 1 ? "1 proposal" : `${chosen.size} proposals`}
        </Button>
      </Actions>
      {acting.error !== undefined && <ErrorMessage error={acting.error} />}
      {results && <BulkResults workspaceId={workspace.id} results={results} />}
    </Section>
  )
}

function BulkResults(props: {
  workspaceId: string
  results: readonly (CatalogBulkApprovalResult | CatalogBulkRejectionResult)[]
}) {
  return (
    <PageNotice>
      <p className="font-semibold" role="status">
        {props.results.length === 1
          ? "1 proposal:"
          : `${props.results.length} proposals:`}
      </p>
      <ul className="list-disc pl-5">
        {props.results.map((r) => (
          <li key={r.proposalId}>
            <Link
              to={wikiPath(props.workspaceId, `/proposals/${r.proposalId}`)}
              className={linkClass}
            >
              {r.number === null
                ? "A proposal"
                : `Catalog proposal ${r.number}`}
            </Link>
            : {resultText(r)}
          </li>
        ))}
      </ul>
    </PageNotice>
  )
}

function resultText(
  r: CatalogBulkApprovalResult | CatalogBulkRejectionResult,
): string {
  switch (r.outcome) {
    case "applied":
      return "approved and applied."
    case "rejected":
      return "rejected."
    case "refused":
      return `not decided: ${visible(r.message)}`
    case "not-attempted":
      return "not reached: Shinan was busy. Try again in a few seconds."
    case "unchanged":
      return "still waiting: its change is already in the catalog; reject it."
    case "conflict":
    case "invalid":
    case "blocked":
      return `still waiting, it no longer applies: ${r.problems.map((p) => visible(p.message)).join(" ")}`
    default:
      return `${r.outcome}.`
  }
}
