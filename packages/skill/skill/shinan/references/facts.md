# Facts, fact checks and provenance

What you write into the catalog must say how it is known. These rules apply
to every fact you propose or recheck.

## Fact states

| State      | Use it when                                                       | Fact check | Source                                                                                     |
| ---------- | ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `intended` | The owning source (a repository, a configuration) declares it now | Required   | The owning source, pinned to a revision (a commit or tag) where possible                   |
| `observed` | You saw it yourself when you checked                              | Required   | What you looked at, how and from where, such as `df -h on the machine`                     |
| `planned`  | It is agreed but not yet in the owning source                     | None       | `task` on the fact: the task ID or accepted `decision` entity behind it                    |
| `unknown`  | You looked and could not tell, or nobody has looked               | Optional   | `note` on the fact says why it is unknown; with a fact check when you looked and could not |

- A `planned` fact can plan a removal with `remove: true`.
- A `planned` or `unknown` fact never becomes true by itself: when the change
  lands or the value is found, write the `intended` or `observed` fact and
  name the fact it settles.
- A change that is merged but not yet applied is `intended`; what you see in
  the world is `observed`. If they differ, both stay, as a discrepancy. Do
  not hide drift by writing only one.

## Fact checks

A fact check records one act of checking; facts checked together share one.

- `checked`: when you actually checked, as a date (`2026-11-18`) or a date
  and time with a UTC offset. Not when you write the proposal.
- `scope`: what exactly you checked, in one line.
- `source`: where the evidence is: a pinned URL, a repository revision, or a
  short description of the observation. Never raw logs or sensitive output.
- `limits`: what you did not or could not check, in one line, when it
  matters.
- Never send `by` or `accepted`. Shinan writes who checked from your token,
  and who accepted a discrepancy from the person who approves it.

## Provenance

- **Copying is not checking.** A value you read in another document, in the
  catalog itself, in a README, in a message or in an earlier session is not
  a check of the fact. At most it tells you where to check.
- **`unknown` over guesses.** If you could not check a fact, write it as
  `unknown` with a note saying why, or leave it out. A guessed fact is worse
  than a known gap, because nobody rechecks it.
- **Check one fact, refresh one fact.** Rechecking a fact records a new fact
  check for that fact only. Never refresh dates you did not check, and never
  claim a whole entity was checked when you checked one fact.
- **Evidence over arrival order.** When values compete, the fact check
  (what was seen, from where, and when) decides, not which proposal came
  last. Two values with valid fact checks may both stay, as a discrepancy;
  give a second observation its own `via` (how it was observed).
- **Link, don't copy.** For something another system owns, record a pointer
  to it (a URL or repository), not a copy of its contents.
- **Secrets stay where they live.** Record where a secret lives, never its
  value: a `secrets-in` relation to the secrets manager's `service` entity,
  with `item` naming the entry (such as `app/production/database`)
  and a `note` saying what it is for. Never write a credential, key, token
  or a URL with a password in it. Shinan refuses text that is almost
  certainly a credential, and holds text that looks like one for a person to
  check; neither is a reason to rephrase a secret until it passes.
