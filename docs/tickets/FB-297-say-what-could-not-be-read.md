# FB-297 — Say what could not be read, once, and whether it clears by itself

**Status:** Done · **Size:** small · **Budget:** none (built by Claude by hand) · **Rough date:** Wednesday 4 November 2026, before the ARCA demo on Monday 9 November · **Asked by:** John, 3 November 2026 (fix 3: explain "Part of this venture could not be read") · **Repo:** fountainbridge · One ticket = one branch = one PR.

## Why

- The Tickets page said only "Part of this venture could not be read". It didn't say what failed.
- The desk named the causes, but always ended "Nothing for you to do; it clears on its own". A
  repository the studio isn't allowed to read never clears by itself. On staging, ARCA's two private
  repositories came back "not found" while the public one read fine, which usually means the
  studio's GitHub key can't see private repositories.
- The same fault was listed up to three times per repository: once by the tickets read, again by the
  open-work read ("arca: The studio could not read arca just now."), and again on the page shown when
  nothing could be read, which listed every message unsorted.

## What changes

- **Each fault is listed once**, with the repositories it affected: "The studio could not read these
  just now. (arca, arca-marketing, arca-ops)".
- **Plain words for the causes:**
  - "GitHub is limiting how much the studio can read just now. This fills in as reads succeed."
  - "GitHub says this isn't there, or the studio isn't allowed to see it."
  - "The studio isn't allowed to read this."
- **The last line says whether it clears by itself:** "Nothing for you to do; it clears on its own",
  or, when any cause won't, "This won't clear on its own: someone has to give the studio access to
  it."
- The same grouping and words on the desk's strip, on the Tickets page, and on the desk shown when
  nothing could be read. The strip's heading is "Part of this venture could not be read" (it was
  "One workstream is catching up").

## Not in this ticket

- Giving the studio's GitHub key access to private repositories, if that is the cause on
  production. That is a setting for John. This change makes the screen say so instead of hiding it.
- For a venture the factory builds, the old machine's "what your team has been doing" read is
  removed by FB-295.

## Acceptance

- [x] One line per cause, naming each repository once (`lib/__tests__/desk.test.ts`).
- [x] "Not found" and "not allowed" say they won't clear on their own; a busy GitHub says it will.
- [x] Pictures at 1440×1000 and 393×851 with every read failed on purpose: the Tickets page and the
  desk each show two lines where they showed seven and ten.
- [x] Every unit test passes, and `npm run test:e2e:degraded` passes.
