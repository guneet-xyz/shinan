export const productName = "Shinan"

export { scopes, shinan, writtenActor } from "./actor.js"
export type {
  Actor,
  AgentActor,
  PersonActor,
  ResolvedActor,
  Scope,
  ShinanActor,
} from "./actor.js"
export { atInstallation, inWorkspace } from "./authorize.js"
export type {
  Context,
  InstallationScope,
  RequestInfo,
  WorkspaceScope,
} from "./context.js"
export {
  CoreError,
  ForbiddenError,
  NotFoundError,
  ReauthenticationRequiredError,
  RuleViolationError,
} from "./errors.js"
export type { RefusalReason } from "./errors.js"
export { appendEvent, listEvents } from "./events.js"
export type { Event, NewEvent, Page } from "./events.js"
export { decide, rules } from "./permissions.js"
export type {
  Action,
  Decision,
  InstallationAction,
  Requester,
  Rule,
  WorkspaceAction,
} from "./permissions.js"
export { recordSecurityEntry } from "./security-log.js"
export type { SecurityEntry } from "./security-log.js"
export { listSecurityLog } from "./security-log-read.js"
export type { SecurityLogEntry } from "./security-log-read.js"
export { getInstallation, setUpInstallation } from "./identity/installation.js"
export type { Installation } from "./identity/installation.js"
export { createPerson } from "./identity/people.js"
export type { NewPerson, Person } from "./identity/people.js"
export { createWorkspace } from "./identity/workspaces.js"
export type { Workspace } from "./identity/workspaces.js"
export {
  addMember,
  changeRole,
  leaveWorkspace,
  listMembers,
  removeMember,
} from "./identity/members.js"
export type { Member, MemberSummary } from "./identity/members.js"
