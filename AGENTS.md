# Agent instructions for Shinan

Shinan's design documents are approved. The project is now in its **build
phase**. Read these before doing anything else:

- [High-level plan](docs/plan.md)
- [Build plan](docs/build-plan.md): milestones, code layout, tooling and how work
  is split and reviewed.
- The [decision log](docs/decisions/README.md) and the documents your work
  implements.

## Working rules

- Track work in this repository's [issues](https://github.com/guneet-xyz/shinan/issues).
  One issue per work package or change. Check open issues and pull requests first.
- Work on your own branch in your own worktree. On Daedalus, worktrees go in
  `/mnt/projects/shinan/<issue>-<slug>`, created from the canonical checkout at
  `/root/shinan`. Never commit to `main` directly; every change lands through a
  reviewed pull request.
- Commit messages and PR titles use Conventional Commits.
- Never deploy, change DNS, or create or read credentials. Prepare the change
  and ask for the owner's approval; people type secrets.
- The repository is private. Do not copy its content to public places.

## Writing code

- Implement what the documents say. If the code needs a choice they do not
  make, propose it in the PR; anything that changes a decision record goes to the
  owner before merge.
- Permissions and rules live in `packages/core`, never only in HTTP handlers.
- Inside a transaction, use its `tx` for every query. Anything that needs
  its own connection, such as `takeRateLimit` or another `inWorkspace`, runs
  before the transaction opens or after it ends: otherwise as many requests
  as the pool has connections hang the process. Tests use a database that
  refuses this (`refuseNestedConnections` in `packages/db`), through `db`
  and its pool, and fails any test that leaves a refusal behind, even one
  the code caught.
- Every PR has tests. Keep CI green: run `pnpm format:write`, `pnpm lint`,
  `pnpm typecheck` and `pnpm test` before pushing (the
  [README](README.md#developing-locally) explains the setup).
- If a change alters behaviour a document describes, update that document in
  the same PR.

## Writing documents

- Use the terms from the [domain model and glossary](docs/domain-model.md)
  exactly.
- Mark every statement as decided, proposed or open, and give the reason for
  every decision.
- Record decisions in `docs/decisions/` and link to them instead of repeating them.
- Link to other documents rather than copying their content.
- Write plainly. Explain jargon or avoid it.
