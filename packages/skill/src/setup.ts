/**
 * The commands that set a machine up for Shinan's catalog (agent
 * integrations, "Setting up an agent with a hand-made token"; plan §2.12).
 * Pure text, without Node.js imports, so the web app's setup page shows
 * exactly what the tests run with a real `git`.
 */

/** Where the token is kept on the machine, readable only by its user. */
export const tokenFile = "~/.config/shinan/token"

/** The default folder of the machine's clone; worktrees go beside it. */
export const defaultCloneFolder = "~/shinan-catalog/main"

/**
 * Stores the token, from any shell: the commands run in bash whatever the
 * shell they are pasted into, so they behave the same everywhere bash is
 * installed, and no other shell is left reading the pasted token as a
 * command. The token is read without echo, so it is not on screen, in
 * scrollback or in history; written by the `printf` builtin, so it is
 * never in the process list; folder 700 and file 600 even if they existed
 * before, the file emptied and locked down before the token goes in.
 */
export const storeTokenCommand = `bash -c 'umask 077; mkdir -p ~/.config/shinan && chmod 700 ~/.config/shinan && IFS= read -rs t && : > ${tokenFile} && chmod 600 ${tokenFile} && printf "%s\\n" "$t" > ${tokenFile}'`

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

/** Quotes a word for a POSIX shell. */
function shellQuote(word: string): string {
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
  const key = `credential.${installationAddress(origin)}.helper`
  return [`${key}=`, `${key}=${credentialHelper}`]
}

/**
 * The catalog repository's address (plan §2.2). **To be confirmed** with
 * GC-2's routes: `/git/<workspace ID>.git`.
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
 * Makes the clone, with the credential helper in its configuration, and
 * records in Git's global configuration where it is (`shinan.catalog`) and
 * how this machine's agent writes `by` (`shinan.by`), which the skill
 * reads. None of it is a secret.
 */
export function cloneCommands(options: {
  origin: string
  workspaceId: string
  by: string
  folder?: string
}): string {
  const folder = options.folder ?? defaultCloneFolder
  return [
    [
      "GIT_TERMINAL_PROMPT=0 git clone",
      ...credentialHelperOptions(options.origin).map(
        (option) => `-c ${shellQuote(option)}`,
      ),
      `${catalogRepositoryUrl(options.origin, options.workspaceId)} ${folder}`,
    ].join(" \\\n  "),
    `git config --global shinan.catalog ${folder}`,
    `git config --global shinan.by ${shellQuote(options.by)}`,
  ].join("\n")
}
