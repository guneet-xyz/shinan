/**
 * The codes of the push checks (Git-based catalog plan §2.5): every refusal
 * and warning a push can get besides the validation codes of the documents
 * on `main` (`ProblemCode`), which GC-3b's checks of `main` add. The skill
 * explains each (`references/changing.md`); its test reads this list.
 *
 * - `blocking` refuses the whole push; a `warning` is printed and does not.
 * - `on`: `any-branch` codes are checked on every push, `main` codes only
 *   when the push changes `main`.
 */
export const pushCheckCodes = {
  "ref-not-branch": { severity: "blocking", on: "any-branch" },
  "ref-name-invalid": { severity: "blocking", on: "any-branch" },
  "main-not-fast-forward": { severity: "blocking", on: "any-branch" },
  "too-many-branches": { severity: "blocking", on: "any-branch" },
  "purged-commit": { severity: "blocking", on: "any-branch" },
  symlink: { severity: "blocking", on: "any-branch" },
  submodule: { severity: "blocking", on: "any-branch" },
  "file-too-large": { severity: "blocking", on: "any-branch" },
  "commit-too-large": { severity: "blocking", on: "any-branch" },
  "too-many-commits": { severity: "blocking", on: "any-branch" },
  "tree-too-large": { severity: "blocking", on: "any-branch" },
  "path-not-portable": { severity: "blocking", on: "any-branch" },
  secret: { severity: "blocking", on: "any-branch" },
  "repository-full": { severity: "blocking", on: "any-branch" },
  busy: { severity: "blocking", on: "any-branch" },
  "too-slow": { severity: "blocking", on: "any-branch" },
  "check-only": { severity: "blocking", on: "any-branch" },
  "push-option-unknown": { severity: "blocking", on: "any-branch" },
  "check-failed": { severity: "blocking", on: "any-branch" },
  /**
   * Until the checks of `main` exist (GC-3b), a push that changes `main` is
   * refused: nothing unvalidated reaches the catalog. GC-3b removes it.
   */
  "main-not-open": { severity: "blocking", on: "main" },
  "secret-suspected": { severity: "warning", on: "any-branch" },
  // The checks of `main` (GC-3b), besides the documents' validation codes.
  "path-not-allowed": { severity: "blocking", on: "main" },
  "path-id-mismatch": { severity: "blocking", on: "main" },
  "id-disappeared": { severity: "blocking", on: "main" },
  "by-not-first-pusher": { severity: "blocking", on: "main" },
  "catalog-too-large": { severity: "blocking", on: "main" },
  "main-too-many-commits": { severity: "blocking", on: "main" },
} as const satisfies Record<
  string,
  { severity: "blocking" | "warning"; on: "any-branch" | "main" }
>

export type PushCheckCode = keyof typeof pushCheckCodes

/** The limits of every push (plan §2.10), besides the body and rate limits of the Git endpoint. */
export const pushLimits = {
  /** New commits one push may bring. */
  newCommits: 1000,
  /** The largest new file, in bytes. */
  fileBytes: 1024 * 1024,
  /**
   * The largest new commit object, in bytes: 64 KiB of message and
   * headers. History reads a commit up to 256 KiB, so every commit pushed
   * reads whole.
   */
  commitBytes: 64 * 1024,
  /** Branches a repository may hold. */
  branches: 100,
  /** The longest branch name. */
  refNameLength: 100,
  /**
   * The most entries in one folder (tree object): `main` holds at most
   * 20,000 documents, so a larger folder is not a catalog.
   */
  folderEntries: 20_000,
  /**
   * The most entries a commit's tree reaches, counting a subtree each time
   * it appears: ten times a catalog at its limits. Many references to one
   * subtree are a few KB in a pack but millions of entries to walk.
   */
  treeEntries: 200_000,
  /** The repository's size on disk; above it, only branch deletions. */
  repositoryBytes: 1024 * 1024 * 1024,
  /** How long a push may wait for the one before it. */
  lockWaitSeconds: 30,
  /** How long the checks of a push to a branch may take. */
  checkSeconds: 30,
} as const
