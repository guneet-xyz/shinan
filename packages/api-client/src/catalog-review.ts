// Catalog proposals as the REST API serves them for review (catalog §8;
// human experience, reviewing catalog changes): the strict setting, bulk
// approval, comments, the recent-changes feed and revert.

import type { ActorKind } from "./index.js"

export type CatalogProposalState =
  "pending" | "applied" | "rejected" | "withdrawn"

/** A catalog proposal (catalog §8.1). */
export interface CatalogProposal {
  id: string
  number: number
  state: CatalogProposalState
  createdAt: string
  author: { kind: ActorKind; label: string }
  explanation: string
  relatedTask: string | null
  /** The operations as sent (catalog §8.1). */
  operations: Record<string, unknown>[]
  basedOnRevision: number
  approvalClasses: string[]
  approvalReasons: string[]
  warnings: {
    code: string
    severity: string
    message: string
    documentId: string | null
  }[]
  touches: string[]
  appliedRevision: number | null
  decidedAt: string | null
  decidedBy: string | null
  rejectionReason: string | null
  /** The applied proposal this one reverts, for a revert. */
  revertsProposalId: string | null
  /**
   * Whether its author is still a current member, or an enabled agent of
   * one; given when proposals are read (a proposal, a list, recent changes).
   */
  authorStatus?: "current" | "agent-disabled" | "member-left"
}

/** An operation that did not apply (catalog §8.5), or a blocking validation problem (§8.3). */
export interface CatalogProposalProblem {
  /** The operation's position, for operation problems. */
  operation?: number
  kind?: "conflict" | "invalid"
  code: string
  severity?: string
  message: string
  documentId: string | null
}

/** What became of a proposal, an approval or a revert. */
export type CatalogProposalOutcome =
  | { outcome: CatalogProposalState; proposal: CatalogProposal }
  | {
      outcome: "conflict" | "invalid" | "blocked"
      problems: CatalogProposalProblem[]
    }
  | { outcome: "unchanged" }

export interface CatalogSettings {
  /** When on, every catalog change except a recheck needs catalog approval. */
  strict: boolean
}

/**
 * Which proposals a bulk action takes: exactly the ones the person was
 * shown, by ID, or a task's waiting proposals up to the highest proposal
 * number shown.
 */
export type CatalogBulkSelection =
  { proposalIds: string[] } | { relatedTask: string; seenUpTo: number }

export type CatalogBulkApprovalResult = {
  proposalId: string
  number: number | null
} & (
  | CatalogProposalOutcome
  | { outcome: "refused"; rule: string; message: string }
  /** Shinan was busy before it reached this one: send it again later. */
  | { outcome: "not-attempted"; retryAfterSeconds: number }
)

export type CatalogBulkRejectionResult = {
  proposalId: string
  number: number | null
} & (
  | { outcome: "rejected"; proposal: CatalogProposal }
  | { outcome: "refused"; rule: string; message: string }
)

export interface CatalogProposalComment {
  id: string
  proposalId: string
  createdAt: string
  author: {
    kind: "person" | "agent"
    label: string
    personId: string | null
    agentId: string | null
  }
  text: string
}

export interface RecentCatalogChange {
  revision: number
  proposal: CatalogProposal
  /** The person whose approval applied it, if it needed one. */
  approvedBy: string | null
  /** Every document it changed is still as it left it. */
  revertible: boolean
  revertedBy: { id: string; number: number; state: CatalogProposalState } | null
}

export interface RecentCatalogChanges {
  items: RecentCatalogChange[]
  /** The revision to pass as `cursor` for the next page, or null. */
  nextCursor: number | null
}
