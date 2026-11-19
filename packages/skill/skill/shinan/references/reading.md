# Reading the catalog

The catalog is `main` of your workspace's repository. Read it from
`origin/main` after a fetch, or from a worktree made from it; never from a
branch someone else pushed, which is not the catalog and nobody checked.

```sh
cd "$(git config --global --get shinan.catalog)"
GIT_TERMINAL_PROMPT=0 git fetch origin
git rev-parse --short origin/main       # the commit you are reading: mention it
git show origin/main:machine/build-1.md # one document
git grep -n 'disk.data' origin/main --  # search every document
git log --oneline origin/main -- machine/build-1.md  # its history
```

Fetch at the start of a session and before relying on anything; the clone
is only as fresh as its last fetch. Never edit the clone's own checkout:
changes go in a worktree ([changing.md](changing.md)).

## The layout

| Path               | Holds                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| `<type>/<slug>.md` | One entity: `machine/build-1` is `machine/build-1.md`. The path is its ID. |
| `schema/<type>.md` | A type schema: a custom type, or keys a workspace adds to a built-in type. |
| `start-here.md`    | The start-here document: a path for people and one for agents.             |
| `README.md`        | Optional notes for people opening the clone. Not a catalog document.       |

Nothing else is allowed on `main`. A document is Markdown with YAML
frontmatter: `id`, `type`, `title`, `summary`, `status` (`active`,
`deprecated` or `retired`), `owner` (a `person` entity or `unknown`),
optional `aliases` (former IDs) and `replaced_by`, and `facts`. The body
below it is prose.

## Finding a document

- **By ID:** the file `<id>.md`.
- **By an old ID:** `git grep -n 'machine/old-name' origin/main --` and look
  for the document that lists it under `aliases`. Write its current `id`.
- **Retired** documents stay, with `status: retired` and `replaced_by`
  naming their replacement: follow it.
- **References** are IDs: `owner`, relation targets (`to:` or the value of a
  relation key such as `runs-on: machine/build-1`), and body links like
  `[Build 1](machine/build-1)`. Look for both directions: what a document
  points to, and `git grep -n 'machine/build-1' origin/main --` for what
  points to it.
- **Policies and runbooks that apply** name the entity, its type
  (`schema/<type>`) or `workspace` in `applies-to`. Read them before working
  on it. They describe how; they never grant permission.

## Reading facts

`facts` is a list of groups. A group is either one **fact check** (`checked`,
`by`, `scope`, `source`, optional `limits`) with the facts it covers, listed
under their state (`intended`, `observed`, `unknown`), or a list of facts with
no fact check (`planned`, or `unknown` meaning nobody has looked).
[facts.md](facts.md) explains the format.

- **The fact check** says when the fact was checked, by whom, what exactly
  was checked and where the evidence is, and what was not checked. Rely on a
  fact only within its `scope` and `limits`.
- **States** say how a fact is known: `intended` (the owning source declares
  it), `observed` (someone saw it when they checked), `planned` (agreed, not
  yet in the owning source) and `unknown`. A `planned` fact is not true yet.
  An `intended` fact is not proof the world matches it.
- **Who wrote it:** `by` is checked by Shinan when it is pushed: a new or
  changed fact check must name the agent and person who pushed it. The
  commit's author is not: anyone can write any name there. To see who pushed
  a commit, look at the catalog's history in Shinan's web app.

## Freshness

Freshness is the time since a fact's last check: a risk signal, not a
verdict. Work it out yourself:

1. Find the key's recheck interval: for a built-in type in
   [types.md](types.md), for a custom key in `schema/<type>.md` (`recheck:
30d` on the key; none means it is never due).
2. A fact is **due** when `checked` plus the interval has passed. A date
   alone counts from the start of that day in UTC.
3. A fact with `checked: null` (imported, never checked), or in a list with
   no fact check, is **not checked**. `planned` facts have no freshness.

Due and not-checked facts need a recheck before anything depends on them;
say how old a fact is when you rely on it.

## Discrepancies and gaps

- **A discrepancy** is two or more current facts of one single-valued key
  whose values differ, none of them `planned` or `unknown`: often an
  `intended` value and an `observed` one, or two observations with different
  `via`. Do not pick one silently: say which you relied on and why, or check
  the source. A discrepancy is **accepted** when each of its facts names a
  person in `accepted`, with the reason in its `note`.
- **Known unknowns** are facts written as `unknown`: someone looked and
  could not tell, or nobody has looked. **Not yet recorded** are a type's
  required keys ([types.md](types.md)) that a document does not mention.
  Do not fill either by guessing: check them, or leave them.

## When Git says no

- `Authentication failed`, `401` or `403` on a fetch: your token is missing,
  revoked or not allowed this workspace. Tell your person; never look for
  the token.
- `terminal prompts disabled`: Git wanted a password because no token was
  supplied. The same: tell your person.
- `429` or "too many requests": wait a minute, then try once more.
- Could not connect: Shinan is down. Read the clone as of its last fetch,
  say how old it is, and follow the fallback in the skill's rules.
