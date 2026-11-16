# Agent instructions for Shinan

Shinan is in its documentation phase. There is no application code yet.
Read [the high-level plan](docs/plan.md) before doing anything else.

## Working rules

- Track work in this repository's [issues](https://github.com/guneet-xyz/shinan/issues).
  One issue per document or change. Check open issues and pull requests first.
- Work on your own branch in your own worktree. On Daedalus, worktrees go in
  `/mnt/projects/shinan/<issue>-<slug>`, created from the canonical checkout at
  `/root/shinan`. Never commit to `main` directly; every change lands through a
  reviewed pull request.
- The repository is private. Do not copy its content to public places.

## Writing documents

- Use the terms from the domain model and glossary exactly once it exists.
- Mark every statement as decided, proposed or open, and give the reason for
  every decision.
- Record decisions in `docs/decisions/` and link to them instead of repeating them.
- Link to other documents rather than copying their content.
- Write plainly. Explain jargon or avoid it.
