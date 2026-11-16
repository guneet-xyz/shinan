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
export { createPerson } from "./identity/people.js"
export type { NewPerson, Person } from "./identity/people.js"
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
export { EmailQueueError, emailLimits, emailQueue } from "./email/queue.js"
export type { EmailJob } from "./email/queue.js"
// Message templates are pure functions, so they bypass no check. The core
// operations that send them (M1-4) queue them with the internal `queueEmail`.
export {
  invitationEmail,
  magicLinkEmail,
  securityAlertEmail,
} from "./email/templates.js"
export type {
  InvitationEmail,
  MagicLinkEmail,
  SecurityAlert,
  SecurityAlertEmail,
} from "./email/templates.js"
