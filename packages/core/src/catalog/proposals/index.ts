// Catalog proposals and approval (catalog §8, §9): storing and applying
// proposals, approval classes and the catalog worker. Only the operations
// and their types are public.
export { approvalClasses, gatedClasses } from "./classify.js"
export type { ApprovalClass } from "./classify.js"
export { estimatedBytes } from "./estimate.js"
export { checkProposalInput, proposalLimits } from "./input.js"
export { configureCatalogWorkers, defaultWorkerOptions } from "./pool.js"
export type { CatalogWorkerOptions } from "./pool.js"
export type { ProposalInput } from "./input.js"
export {
  approveCatalogProposal,
  catalogLimits,
  getCatalogProposal,
  listCatalogProposals,
  proposeCatalogChange,
  rejectCatalogProposal,
  rejectionReasonLimit,
  withdrawCatalogProposal,
} from "./proposals.js"
export type {
  ApprovalOutcome,
  CatalogProposal,
  ListProposalsInput,
  NotApplied,
  ProposalOutcome,
} from "./proposals.js"
