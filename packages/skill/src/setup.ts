/**
 * The command that sets a machine up for Shinan's catalog (agent
 * integrations, "Setting up an agent with a hand-made token"; plan §2.12).
 * Pure text, without Node.js imports, so the web app's setup page shows
 * exactly what the tests run with a real `git`.
 */

/** Where the token is kept on the machine, readable only by its user. */
export const tokenFile = "~/.config/shinan/token"

/** The default folder of the machine's clone; worktrees go beside it. */
export const defaultCloneFolder = "~/shinan-catalog/main"

/** What the command prints when it waits for the token. */
export const tokenPrompt =
  "Paste the agent token (it is not shown), then press Enter: "

/**
 * The credential helper, as Git runs it (through `sh -c`, with the action
 * as its argument). It answers only `get`, so Git can never make it store
 * or erase anything, and the token goes from the file to Git's standard
 * input without ever being on a command line (`printf` is a builtin).
 */
export const credentialHelper = `!f() { test "$1" = get && printf "username=agent\\npassword=%s\\n" "$(cat ${tokenFile})"; }; f`

/** The installation's address as Git matches it: scheme, host and port, no path. */
export function installationAddress(origin: string): string {
  const url = new URL(origin)
  return `${url.protocol}//${url.host}`
}

/** Quotes a word for a POSIX shell, when it needs quoting. */
function shellQuote(word: string): string {
  if (/^[\w@%+=:,./-]+$/.test(word)) return word
  return `'${word.replaceAll("'", "'\\''")}'`
}

/**
 * The credential helper's configuration, given to `git clone` with `-c`
 * so Git writes it into the clone's own configuration: an empty value
 * first, which drops every helper configured before for the installation's
 * address, then Shinan's. The clone's configuration is read after the
 * global and system ones, so no other helper, wherever it is configured
 * (such as `store`, which would save the token in plain text), is ever
 * asked for, or told, the token. Worktrees share it.
 */
export function credentialHelperOptions(origin: string): string[] {
  const key = helperKey(origin)
  return [`${key}=`, `${key}=${credentialHelper}`]
}

function helperKey(origin: string) {
  return `credential.${installationAddress(origin)}.helper`
}

/**
 * The catalog repository's address, the "address for agents" (plan §2.2).
 * **To be confirmed** with GC-2's routes: `/git/<workspace ID>.git`.
 */
export function catalogRepositoryUrl(
  origin: string,
  workspaceId: string,
): string {
  return `${installationAddress(origin)}/git/${workspaceId}.git`
}

/** A written actor's form for an agent (identity §8.7). */
export function writtenAgent(personHandle: string, agentHandle: string) {
  return `${personHandle} via ${agentHandle}`
}

/**
 * The one command a person runs on the machine, in any shell (it runs in
 * bash whatever the shell it is pasted into, and is one line, so shells
 * without multi-line quotes take it too). It:
 *
 * 1. asks for the token and reads it without echo, so it is not on screen,
 *    in scrollback or in history, and writes it with the `printf` builtin,
 *    so it is never in the process list, into a file only its user can
 *    read (folder 700, file 600 even if they existed before, the file
 *    emptied and locked down before the token goes in);
 * 2. clones the catalog, with the credential helper in the clone's own
 *    configuration (`credentialHelperOptions`), unless the folder exists,
 *    so running it again only replaces the token;
 * 3. records in Git's global configuration where the clone is
 *    (`shinan.catalog`) and how the agent writes `by` (`shinan.by`), which
 *    the skill reads. Neither is a secret.
 */
export function setupCommand(options: {
  origin: string
  workspaceId: string
  by: string
  folder?: string
}): string {
  const folder = options.folder ?? defaultCloneFolder
  const script = [
    "set -e",
    "umask 077",
    "mkdir -p ~/.config/shinan",
    "chmod 700 ~/.config/shinan",
    `printf %s "${tokenPrompt}" >&2`,
    "IFS= read -rs t",
    "echo >&2",
    `[ -n "$t" ] || { echo "No token was pasted." >&2; exit 1; }`,
    `: > ${tokenFile}`,
    `chmod 600 ${tokenFile}`,
    `printf "%s\\n" "$t" > ${tokenFile}`,
    "unset t",
    // The helper's leading `!` is made by printf (octal 041): a `!` in the
    // pasted line would be history expansion in csh and tcsh, even inside
    // single quotes.
    `helper=$(printf "\\041%s" ${shellQuote(credentialHelper.slice(1))})`,
    [
      `[ -e ${folder} ] || GIT_TERMINAL_PROMPT=0 git clone -q`,
      `-c ${helperKey(options.origin)}=`,
      `-c "${helperKey(options.origin)}=$helper"`,
      `"${catalogRepositoryUrl(options.origin, options.workspaceId)}" ${folder}`,
    ].join(" "),
    `git config --global shinan.catalog ${folder}`,
    `git config --global shinan.by "${options.by}"`,
    `echo "Done. The catalog is in ${folder}." >&2`,
  ].join("; ")
  return `bash -c ${shellQuote(script)}`
}
