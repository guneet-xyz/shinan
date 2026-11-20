// Only operations are public. The check path (`inWorkspace`, `atInstallation`),
// scopes and the event and security-log writers stay inside core, so the
// pairing of each operation with its permission action lives here alone.
export const productName = "Shinan"

export { scopes, shinan, writtenActor } from "./actor.js"
export type {
  Actor,
  AgentActor,
  PersonActor,
  Scope,
  ShinanActor,
} from "./actor.js"
export type { Context, RequestInfo } from "./context.js"
export {
  BusyError,
  CoreError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
  ReauthenticationRequiredError,
  RuleViolationError,
} from "./errors.js"
export type { RefusalReason } from "./errors.js"
export { listEvents, pageSize } from "./events.js"
export type { Event, Page } from "./events.js"
export { decide, rules } from "./permissions.js"
export type {
  Access,
  Action,
  Decision,
  InstallationAction,
  Requester,
  Rule,
  WorkspaceAction,
  WriteAction,
} from "./permissions.js"
export { listSecurityLog } from "./security-log-read.js"
export type { SecurityLogEntry } from "./security-log-read.js"
export { getInstallation, setUpInstallation } from "./identity/installation.js"
export type { Installation } from "./identity/installation.js"
export type { Person } from "./identity/people.js"
export {
  addToAllowlist,
  listAllowlist,
  removeFromAllowlist,
  syncOperators,
} from "./identity/allowlist.js"
export type { AllowlistEntry } from "./identity/allowlist.js"
export {
  checkAddGitHub,
  describeClient,
  endAllSignInSessions,
  endSignInSession,
  findPendingGitHubSignIn,
  listSignInSessions,
  maySignIn,
  openSignInLink,
  pendingGitHubMinutes,
  pruneSignInRecords,
  prepareSetupLink,
  reauthenticationMinutes,
  recordGitHubAdded,
  recordSignIn,
  recordSignInFailure,
  recordSignOut,
  removeGitHub,
  sendSignInLink,
  setupLinkHours,
  signInLinkMinutes,
  startGitHubSignIn,
  startSetup,
} from "./identity/sign-in.js"
export type {
  GitHubSignInMethod,
  OpenedSignInLink,
  SignInMethod,
  SignInRecord,
  SignInSession,
} from "./identity/sign-in.js"
export {
  cancelEmailChange,
  confirmEmailChange,
  emailChangeMinutes,
  getEmailChange,
  requestEmailChange,
} from "./identity/email-change.js"
export type { PendingEmailChange } from "./identity/email-change.js"
export {
  acceptInvitation,
  createInvitation,
  declineInvitation,
  expireInvitations,
  expiryBatch,
  findInvitation,
  invitationDays,
  listInvitations,
  listInvitationsForYou,
  resendInvitation,
  withdrawInvitation,
} from "./identity/invitations.js"
export type {
  Invitation,
  InvitationForYou,
  InvitationKey,
} from "./identity/invitations.js"
export { changeEmailOf, endSessionsOf } from "./identity/recovery.js"
export {
  agentHandlePartLimit,
  authenticateAgent,
  createAgentToken,
  disableAgent,
  enableAgent,
  getConnectedAgent,
  issueAgentToken,
  listAgents,
  listYourAgents,
  renameAgent,
  revokeAgentToken,
  summarizeAgentTokenUse,
  tokenScopes,
  unusedTokenDays,
} from "./identity/agents.js"
export {
  catalogRepositoryUrl,
  getAgentWorkspaceContext,
} from "./identity/agent-context.js"
export type { AgentWorkspaceContextAnswer } from "./identity/agent-context.js"
export type {
  Agent,
  AgentAuthentication,
  AgentLabel,
  AgentToken,
  ConnectedAgent,
  IssuedToken,
  TokenAccess,
} from "./identity/agents.js"
export {
  agentTokenPattern,
  agentTokenPrefix,
  hashToken,
  newAgentToken,
} from "./tokens.js"
export { isEmailAddress } from "./validation.js"
export { clientDescription } from "./security-log.js"
export { getAccount } from "./identity/account.js"
export type { Account, AccountWorkspace } from "./identity/account.js"
export {
  createWorkspace,
  getWorkspace,
  renameWorkspace,
} from "./identity/workspaces.js"
export type { Workspace, WorkspaceDetails } from "./identity/workspaces.js"
export {
  addMember,
  changeRole,
  leaveWorkspace,
  listMembers,
  removeMember,
} from "./identity/members.js"
export type { Member, MemberSummary } from "./identity/members.js"
export type { JobQueue, QueueDefinition } from "./jobs.js"
export { jobQueues } from "./queues.js"
export { deliverEmail, EmailRetryError } from "./email/deliver.js"
export type { DeliveryOutcome, EmailAttempt } from "./email/deliver.js"
export {
  emailRecordRetentionDays,
  lostEmailGraceMinutes,
  pruneEmailDeliveries,
} from "./email/prune.js"
export type { PruneResult } from "./email/prune.js"
export {
  EmailQueueError,
  emailLimits,
  emailQueue,
  throttleAddress,
} from "./email/queue.js"
export type { EmailJob } from "./email/queue.js"
export { pruneRateLimits, rateLimits, takeRateLimit } from "./rate-limits.js"
export type {
  RateLimit,
  RateLimitName,
  RateLimitOptions,
  RateLimitOutcome,
} from "./rate-limits.js"
// Message templates are pure functions, so they bypass no check. The core
// operations that send them queue them with the internal `queueEmail`.
export {
  emailChangeEmail,
  invitationEmail,
  magicLinkEmail,
  securityAlertEmail,
} from "./email/templates.js"
export type {
  EmailChangeEmail,
  InvitationEmail,
  MagicLinkEmail,
  SecurityAlert,
  SecurityAlertEmail,
} from "./email/templates.js"
// The catalog document model is pure, like the templates: it reads text and
// bypasses no check. Catalog operations with permissions are built on it.
export * from "./catalog/document/index.js"
export * from "./catalog/index/index.js"
export {
  getCatalogDocumentText,
  listCatalogHistory,
  listCatalogTypeIndex,
  typeIndexLimit,
} from "./catalog/wiki.js"
export type {
  CatalogDocumentTextAnswer,
  CatalogHistoryAnswer,
  CatalogHistoryItemJson,
  FreshnessSummaryJson,
  TypeIndexAnswer,
  TypeIndexItemJson,
} from "./catalog/wiki.js"
export * from "./catalog/purge/index.js"
export {
  decodeGitContext,
  encodeGitContext,
  gitContextHeader,
  gitContextMaxLength,
  GitContextError,
  maxAllowedValues,
  maxContextMemberHandles,
  maxDocumentsPerRead,
  maxFileBytes,
  maxHistoryPage,
  maxJournalPage,
  maxRequestBodyBytes,
  serviceTokenMinLength,
} from "./catalog/git/api.js"
export type {
  CommitIdentityInfo,
  CommitInfo,
  CommitRef,
  DocumentRead,
  GitRequestContext,
  JournalEntry,
  RepositoryFile,
  RepositoryInfo,
  TreeChange as GitTreeChange,
  TreeEntry as GitTreeEntry,
} from "./catalog/git/api.js"
export { createGitClient, GitServiceError } from "./catalog/git/client.js"
export type { GitClient, GitClientOptions } from "./catalog/git/client.js"
export {
  catalogRepositoryQueue,
  createCatalogRepository,
  repositoryFirstCommitMessage,
  repositoryReadme,
  requestPendingCatalogRepositories,
} from "./catalog/git/repositories.js"
export type { CatalogRepositoryJob } from "./catalog/git/repositories.js"
