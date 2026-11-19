import type { ApprovalClass, CatalogProposalState } from "@shinan/api-client"

/** Catalog §8.2's approval classes, in words. */
const classWords: Record<ApprovalClass, string> = {
  recheck: "a recheck",
  "observed-or-unknown": "observed or unknown facts",
  intended: "intended facts",
  planned: "planned changes",
  "body-and-bookkeeping": "text and bookkeeping",
  rules: "rules",
  lifecycle: "lifecycle",
  "people-and-agents": "people and agents",
  doubtful: "doubtful",
}

export function classNames(c: ApprovalClass): string {
  return classWords[c]
}

export const stateWords: Record<CatalogProposalState, string> = {
  pending: "waiting for approval",
  applied: "applied",
  rejected: "rejected",
  withdrawn: "withdrawn",
}
