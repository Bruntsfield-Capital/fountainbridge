# Project workflow guidance

Keep project constraints and irreversible-action requirements in this file and the
native project guidance. Shared workflow gates own authorization. The factory does
not interpret this document as a private merge policy.

Preserve scope, tests, security invariants and secrets. Report failed or unavailable
checks truthfully. Ordinary static/unit success does not replace required runtime
or holdout verification. Each required assertion needs observable evidence.

Specify this application's protected paths, required validation coverage and
publication constraints in the shared workflow's supported inputs.

**Irreversible actions stop the factory.** Changing identity, authentication or who
may act as whom, and migrating or deleting stored data, are never decided by an
agent: an issue that needs one is held for a human.

**Issues close only on John's word.** An issue may close when the pull request that delivers
it merges on John's Approve: that merge is his word, so its pull request may say "Closes #N".
Nothing else closes an issue. When the factory finds an issue needs no work, is blocked, or
repeats another, it says so on the issue and labels it, and leaves it open for John.

**A pull request brings its own ticket up to date.** When the factory's pull request delivers a
ticket, the same pull request sets that ticket's **Status** to done and ticks what it proved, in the
ticket's file. A ticket is never left saying "Todo" or "In progress" after its work merges.
