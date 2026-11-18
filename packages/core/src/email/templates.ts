import type { EmailContent, Role } from "@shinan/db"

/**
 * The messages Shinan sends in the first version (architecture §9.1). What
 * they say is identity's (§3.1, §3.3, §5.2). They stay short: a title, the
 * workspace where there is one, and a link; never tokens other than the
 * magic link itself, fact values or comment text (architecture §9.2).
 *
 * Callers pass the installation's name and full links; these functions only
 * render. Every value from outside is put on one line in subjects and
 * escaped in HTML.
 */

export interface MagicLinkEmail {
  installationName: string
  /** The sign-in link; it works once (identity §3.1). */
  link: string
  expiresInMinutes: number
}

/** The email magic link (identity §3.1). */
export function magicLinkEmail(input: MagicLinkEmail): EmailContent {
  const installation = short(input.installationName)
  const minutes = Math.max(1, Math.round(input.expiresInMinutes))
  return render(`Sign in to ${installation}`, [
    `Use this link to sign in to ${installation}. It works once and expires in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    { link: checkLink(input.link), label: `Sign in to ${installation}` },
    "If you did not ask to sign in, you can ignore this email. Nobody can sign in without the link.",
  ])
}

export interface EmailChangeEmail {
  installationName: string
  /** The confirmation link (identity §3.4). */
  link: string
  expiresInMinutes: number
}

/**
 * The link that confirms a new email address (identity §3.4), sent to that
 * address. It works only for the person who asked, signed in.
 */
export function emailChangeEmail(input: EmailChangeEmail): EmailContent {
  const installation = short(input.installationName)
  const minutes = Math.max(1, Math.round(input.expiresInMinutes))
  return render(`Confirm your new email address for ${installation}`, [
    `Someone signed in to ${installation} asked to use this address for their account. To confirm it is yours, open the link while signed in to that account. It works once and expires in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    { link: checkLink(input.link), label: "Confirm this email address" },
    "If you did not ask for this, ignore this email: nothing changes without the link.",
  ])
}

export interface InvitationEmail {
  installationName: string
  workspaceName: string
  /** The inviter's written form (identity §8.7), such as `guneet`. */
  invitedBy: string
  role: Role
  /** The acceptance link (identity §5.2). */
  link: string
  expiresAt: Date
}

/** An invitation to join a workspace (identity §5.2). */
export function invitationEmail(input: InvitationEmail): EmailContent {
  const installation = short(input.installationName)
  const workspace = short(input.workspaceName)
  const inviter = short(input.invitedBy)
  const role = input.role === "owner" ? "a workspace owner" : "a contributor"
  return render(`${inviter} invited you to ${workspace} on ${installation}`, [
    `${inviter} invited you to join the workspace "${workspace}" on ${installation} as ${role}.`,
    `To accept, open the link and sign in with this email address. The invitation expires on ${formatTime(input.expiresAt)}.`,
    { link: checkLink(input.link), label: "Open the invitation" },
    "If you were not expecting this, you can ignore this email.",
  ])
}

/** The security events that email the person (identity §3.3). */
export type SecurityAlert =
  | {
      kind: "new-browser-sign-in"
      /** The browser, as described from its user agent. */
      client: string
      at: Date
    }
  | { kind: "github-added"; githubLogin: string; at: Date }
  | { kind: "github-removed"; githubLogin: string; at: Date }
  | {
      kind: "email-change-requested"
      /** The address the change would move the account to. */
      newEmail: string
      at: Date
    }
  | {
      kind: "email-changed"
      from: string
      to: string
      at: Date
    }
  | {
      kind: "agent-token-approved"
      /** The agent's handle, such as `opencode-daedalus`. */
      agentHandle: string
      workspaceName: string
      at: Date
    }

export interface SecurityAlertEmail {
  installationName: string
  /** The person's account page, where they can end sign-in sessions. */
  accountLink: string
  alert: SecurityAlert
}

/** A security alert to the person whose account it is (identity §3.3). */
export function securityAlertEmail(input: SecurityAlertEmail): EmailContent {
  const installation = short(input.installationName)
  const { alert } = input
  const when = formatTime(alert.at)
  let subject: string
  let what: string
  switch (alert.kind) {
    case "new-browser-sign-in":
      subject = `New sign-in to ${installation}`
      what = `Your ${installation} account was signed in to from a browser not seen before (${short(alert.client, 200)}) on ${when}.`
      break
    case "github-added":
      subject = `GitHub sign-in added to your ${installation} account`
      what = `The GitHub account @${short(alert.githubLogin)} was added as a way to sign in to your ${installation} account on ${when}.`
      break
    case "github-removed":
      subject = `GitHub sign-in removed from your ${installation} account`
      what = `The GitHub account @${short(alert.githubLogin)} was removed as a way to sign in to your ${installation} account on ${when}.`
      break
    case "email-change-requested":
      subject = `Email address change requested for your ${installation} account`
      what = `A change of your ${installation} account's email address to ${short(alert.newEmail, 200)} was requested on ${when}. It takes effect only when the link sent to that address is opened.`
      break
    case "email-changed":
      subject = `Your ${installation} account's email address changed`
      what = `The email address of your ${installation} account changed from ${short(alert.from, 200)} to ${short(alert.to, 200)} on ${when}. Sign-in links now go to the new address, and other sign-in sessions were ended.`
      break
    case "agent-token-approved":
      subject = `Agent token approved for ${short(alert.agentHandle)}`
      what = `An agent token was approved for ${short(alert.agentHandle)} in the workspace "${short(alert.workspaceName)}" on ${installation} on ${when}.`
      break
  }
  return render(subject, [
    what,
    "If this was you, there is nothing to do. If it was not, review your account now: end sign-in sessions you do not recognize and revoke tokens you did not approve.",
    { link: checkLink(input.accountLink), label: "Review your account" },
  ])
}

type Block = string | { link: string; label: string }

function render(subject: string, blocks: readonly Block[]): EmailContent {
  const text = blocks
    .map((block) => (typeof block === "string" ? block : block.link))
    .join("\n\n")
  const body = blocks
    .map((block) =>
      typeof block === "string"
        ? `<p>${escapeHtml(block)}</p>`
        : `<p><a href="${escapeHtml(block.link)}">${escapeHtml(block.label)}</a></p>\n<p style="color:#555;font-size:13px">Or copy this address into your browser: ${escapeHtml(block.link)}</p>`,
    )
    .join("\n")
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:sans-serif;line-height:1.5;max-width:560px">
${body}
</body>
</html>
`
  return { subject, text: `${text}\n`, html }
}

/**
 * Text from outside on one line and of a sensible length, so it cannot add
 * header lines or swamp the message.
 */
function short(value: string, max = 100): string {
  const line = value.replace(/\s+/g, " ").trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Only web links; anything else (such as `javascript:`) is a bug. */
function checkLink(link: string): string {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    throw new Error("An email link must be an absolute URL")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("An email link must use https or http")
  }
  return url.href
}

function formatTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
