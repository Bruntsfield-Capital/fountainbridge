# FB-290 — A founder's notice goes by email when their phones can't be read

**Status:** Done · **Kind:** small · **Budget:** none (built in a Claude session, by hand) · **Phase:** 3 · **Raised by:** John, 3 November 2026 (the ARCA-087 dry run: "Confirm that Matthew got exactly one notice and by which route (phone or email) ... If anything needed a nudge, say what and why.") · One ticket = one branch = one PR.

## What happened

In the dry run on 2 November, ARCA's pull request #126 finished at 21:52 and its card reached the
production studio. The studio tried to tell ARCA's founder, and sent nothing, on all three tries:

    [founder-messages] arca arca#126 finished: no message was sent: relation "pushstore.subscriptions" does not exist

Production has no phone table. `db/005_push.sql` (FB-141) was never run there, but `db/012` lists it
as run, because 012 marked every file from 001 to 012 as run without checking. So the deploy log's
"every schema file this version needs" was true of the list, not of the database.

Two faults in FB-279's code made it worse:

- Reading the founder's phones failed, and that stopped the whole message. The email was never
  tried, though production has every email setting.
- After three tries, the studio gave up and told John "the studio stopped before it finished
  sending it". That was not the reason.

## What was built

- **Email when the phones can't be read.** If the list of the founder's phones can't be read, the
  message goes by email. This can't send both: sending to a phone never fails partway (each phone's
  send returns a result, it never throws), so a failure here means no phone has it.
- **A dead phone that can't be removed is only counted.** Removing a phone that has gone could fail
  after another phone already had the message. Before, that failure made it look as if nothing went,
  and an email could follow. Now it is counted as failed, and the phone is tried and removed next
  time.
- **A fault writes its reason.** When a fault stops a try the studio holds, the message is marked
  "not sent" with a plain reason ("a fault stopped the studio while it was sending it (the studio's
  log says which)"). It is tried again as before. When it is given up, John is told that reason.
  Only a try cut off by a restart still says "the studio stopped before it finished sending it".
  The mark is written only while the message is still the studio's own (`pending`), so it can never
  undo a message another request has sent.

The phone table itself is not made by code: John runs `db/005_push.sql` on production.

## Done when

- [x] With no phone table, the founder gets one email, and the log says the phones couldn't be read.
- [x] With no phone table and no email settings, the reason says both.
- [x] A phone that took the message and a dead phone that can't be removed: one notice, no email.
- [x] A fault writes a plain reason; three such tries are given up and reported with it.
- [x] A fault never rewrites a message another request finished.
- [x] Each of these tests fails with its fix taken out.

Outside this pull request: John runs `db/005_push.sql` on production (from `~/run/db-005-push.sql`
on the planning box), so phones can be signed up there at all.
