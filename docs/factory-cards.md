# The factory's door: cards, pictures, preview links, heartbeats and presses

The planning box sends the studio four kinds of thing: **cards**, **screenshots**, **preview links**
and **heartbeats**. It also collects the **presses** made on the cards in the studio, says what
happened to each, and reports the taps made on Telegram. All of it goes through one door,
`POST /api/factory`, signed with a secret only the box and the studio hold. The box has no address
the studio could call, so it asks. This page is what the box's side (cowgate CG-0063, CG-0065 and
CG-0066) is built against. The studio's side is `lib/factory-door.ts` (FB-275, FB-276).

## Rules that hold for every request

- **The venture is never yours to say.** The studio works it out from the card's `repo` and the
  venture manifests' `repos`. A repository no venture lists is refused. You may send `venture` as a
  check; if it does not match the repository's venture, the request is refused.
- **The factory's own work is the one exception (FB-277).** Cards for `cowgate` (or
  `wealthcx01/cowgate`) are kept under `_factory`, a venture id no manifest can have, whatever any
  manifest lists. If you send `venture` with one, it must be `_factory`. No founder can list, open
  or press these cards: only John sees them, on his cross-venture pages (`/attention` while one
  waits, and `/activity`). They have no Review screen in the studio, so press them on Telegram.
  `collect` and `press-result` cover `_factory` like any venture.
- **Anything not marked founder-safe is John's.** A card's founder-safe parts are the fields listed
  under "Plain parts" below, by name. Every other field on a card is kept for John only and never
  reaches a founder's browser. So a new field is safe to add: it stays John's until the studio names
  it as plain. Plain parts are still checked again for a dollar figure, "What to do next" or Archon
  before a founder reads them, but do not rely on that.
- **Screenshots live in the studio's database only.** Never in git, never on disk.

## Signing

Send two headers with every request:

| Header | Value |
|---|---|
| `x-factory-timestamp` | the time now, in whole seconds since 1970 (Unix time), as digits |
| `x-factory-signature` | `sha256=` and the lower-case hex HMAC-SHA256, keyed with `FACTORY_DOOR_SECRET`, of the timestamp, a full stop, then the exact bytes of the body |

Sign the bytes you send. Do not re-encode the JSON after signing. The timestamp must be within five
minutes of the studio's clock, either way, or the request is refused; sign again on every retry.

A worked example. Secret `example-secret`, timestamp `1793782800`, body `{"kind":"heartbeat"}`:

```
signed text:  1793782800.{"kind":"heartbeat"}
header:       x-factory-signature: sha256=33fb545d78ddc9df7b1428e21a112c6776d67017c2ba13186f8b66664d200f0a
```

In a shell: `printf '%s' "$ts.$body" | openssl dgst -sha256 -hmac "$FACTORY_DOOR_SECRET"`.

## Sizes

- A screenshot request: at most 6 MB in all; the PNG itself at most 4 MB once decoded.
- Everything else: at most 64 KB.
- The studio's answer to a `collect`: at most 56 KB, so it fits the same limit.

## The kinds

Every body is a JSON object with `kind`: `card`, `screenshot`, `preview` and `heartbeat` bring things
in; `collect`, `press-result` and `answered-elsewhere` are about presses (below). Dates are ISO 8601, for example `2026-11-04T09:15:00Z`.

### `card`

One card per pull request. Send it again whenever it changes; the newest `sentAt` wins, and an
older one arriving late is refused with 409.

```json
{
  "kind": "card",
  "repo": "arca",
  "number": 21,
  "runId": "run-7f3a",
  "state": "finished",
  "sentAt": "2026-11-04T09:15:00Z",
  "previewUrl": "https://arca-pr-21.up.railway.app",

  "ref": "ARCA-072",
  "title": "Prices in pounds for every collector",
  "finishedAt": "2026-11-04T09:15:00Z",
  "headSha": "4f2c9e1",
  "summary": "Every price on ARCA now shows in pounds, whichever country a collector signs up from.",
  "changes": [{ "label": "Changed", "text": "prices show in pounds everywhere, with the pound sign." }],
  "reaches": "Every collector who sees a price on ARCA",
  "checks": { "passed": 3, "total": 3 },
  "trail": [{ "at": "2026-11-04T09:15:00Z", "tone": "ok", "text": "Your team finished it and checked it three ways." }],

  "forJohn": {
    "cost": "$2.10, of a $15 budget",
    "nextStep": "What to do next: approve it once ARCA's founder has signed it off.",
    "runUrl": "https://archon.example/runs/7f3a"
  }
}
```

**Where it is from** (needed): `repo` (the manifests' name, `arca`, or the full `wealthcx01/arca`),
`number` (the pull request), `state`, `sentAt`. Optional: `runId` (up to 100 characters),
`venture` (a check only), `previewUrl` (must be a preview address, see below; leave it out to keep
the one the studio has).

`state` is one of `finished`, `stuck`, `sent-back`, `done`, `failed`, `needs-you`. Only a `finished`
card has a Review screen.

**Where a card shows (FB-277).** There is no factory page. A card is a row in the lists a founder
already has: the desk's "Waiting on you", the Tickets screen's "Needs you", the rail's count, and
"What happened". `finished`, `stuck` and `sent-back` cards wait on whoever looks at the venture, and
are counted in "Needs you". A card a founder has signed off, or one you send as `needs-you`, waits
on John alone. `done` and `failed` cards, and every press and its answer, are lines in "What
happened". A `stuck` card is also named on the desk's stuck line. When a card and a pull request
the studio reads from GitHub are the same work (same repository and number, or the same `ref` in
the same repository), only the card's row is shown, and it is counted once. A founder reads only
the plain parts; John also reads `forJohn.cost` and `forJohn.nextStep` on the rows.

**Plain parts** (founder-safe, by name): `ref` (up to 40 characters), `title` (needed, up to 300),
`finishedAt`, `headSha` (the commit the work and its pictures are of), `demo` (true for made-up
cards), `summary` (up to 4,000), `changes` (up to 30 of `{ label, text }`), `reaches` (up to 500),
`checks` (`{ passed, total }`), `trail` (up to 50 of `{ at, tone, text }`, where `tone` is `ok`,
`working`, `attention`, `blocked` or `idle`). Leave out what a card does not have.

**John's parts**: everything else. The Review screen shows John `forJohn.cost`, `forJohn.nextStep`
and `forJohn.runUrl` (which must be an `https://` address). Anything else is kept for him too.

### `screenshot`

One picture of one card's work. Send the card first.

```json
{
  "kind": "screenshot",
  "repo": "arca",
  "number": 21,
  "name": "after-phone",
  "headSha": "4f2c9e1",
  "takenAt": "2026-11-04T09:16:00Z",
  "png": "<the PNG, base64>"
}
```

`name` is `before-computer`, `after-computer`, `before-phone` or `after-phone` (1440×1000 and
393×851). It must be a PNG: the studio checks the first bytes and reads the size from them.
`headSha` must be the card's: a picture of another version is refused. When a newer card arrives
with a different `headSha`, the pictures of the old one are removed, so send them again.

### `preview`

The pull request's preview link, when it comes up after the card. Send `"url": null` to remove it.

```json
{ "kind": "preview", "repo": "arca", "number": 21, "url": "https://arca-pr-21.up.railway.app" }
```

A preview address is `https://` on a preview host (`*.up.railway.app`, `*.vercel.app`,
`*.netlify.app`, `*.pages.dev`), with no port and no user name (`lib/preview-address.ts`). The
studio opens it again before it draws it as a link.

### `heartbeat`

Once a minute. The studio keeps the time from your signed timestamp.

```json
{ "kind": "heartbeat", "box": "planning-box" }
```

`box` is optional (`planning-box` when left out): lower-case letters, digits and dashes.

**If `planning-box` sends no heartbeat for five minutes** (FB-278), the studio treats its cards as
out of date. Each card says "The factory hasn't reported since 10:42. These may be out of date.",
its buttons switch off, and a press made anyway is refused and not kept. The next heartbeat turns
the buttons back on. A box that has never sent one is not treated as quiet.

## Presses (FB-276)

A **press** is a button pressed on a card in the studio: `stop`, `send-back`, `accept`, `approve`,
`reject`, `try-again` or `split`. The studio checks who pressed and keeps the press. It never calls
Archon or GitHub for a factory card. The box collects the press, runs it through the same code as a
tap on Telegram, and says what happened.

- **Who may press what is checked by the studio**, before anything is kept. A founder may press
  `stop`, `send-back` and `accept` on their own venture's cards. Only John (`STUDIO_ADMIN_EMAILS`)
  may press `approve`, `reject`, `try-again` and `split`. A press a founder is not allowed to make
  is refused and never kept, so the box never sees it. `byJohn` is the studio's, never the browser's.
- **A founder's `accept` is their sign-off.** It settles nothing and merges nothing: the card says
  "Signed off by <founder>, waiting for John". Sign-offs come back from `collect` in their own list,
  `signOffs`, never in `presses`. They are for the words on Telegram's card. **Never send one to
  Archon.** John's Accept in the studio is kept as `approve`.
- **The first press wins.** Every press but `accept` settles the card. Once one stands (not
  answered yet, or answered `done`), the studio refuses any other with "This card is out of date:
  the run isn't waiting at it any more. Nothing was done." A press you answer `out-of-date` or
  `refused` did nothing, so it no longer stands.
- **A press you don't take, or don't answer, lapses** (FB-278). Collect a press within 10 minutes
  of when it was pressed, and answer it within 10 minutes of collecting it. Past either, the card
  says "Nothing was done." and takes a new press. A press left uncollected that long is never handed
  out: `collect` skips it. A press you collected can still be answered late. Your answer is kept,
  and the card shows it, because you may have acted on it.
  If a new press was made after it lapsed and you did that one too, both answers are kept and the
  card shows the later.
- **A press is about one version of the work**, the card's `headSha` when it was pressed
  (`seenHeadSha`). When you send a card with a new `headSha`, it starts again with no presses.

### `collect`

```json
{ "kind": "collect" }
```

Answers 200 with every press not yet collected, across every venture, oldest first:

```json
{
  "ok": true,
  "message": "1 press, 1 sign-off.",
  "presses": [
    {
      "id": "6f1c0a52-3b7e-4c1d-9a41-2f0e8c7d5b10",
      "venture": "arca",
      "repo": "arca",
      "number": 21,
      "action": "approve",
      "by": "john.gallagher@wealthcx.com",
      "byJohn": true,
      "note": "",
      "seenHeadSha": "4f2c9e1",
      "pressedAt": "2026-11-04T09:20:00.000Z"
    }
  ],
  "signOffs": [
    { "id": "…", "venture": "arca", "repo": "arca", "number": 21, "action": "accept", "by": "arca.founder@bruntsfield.capital", "byJohn": false, "note": "", "seenHeadSha": "4f2c9e1", "pressedAt": "2026-11-04T09:12:00.000Z" }
  ],
  "more": false
}
```

- Each press is handed out **once**. What a collect returns is marked collected, so asking again
  returns only what is new. Keep what you were given before you act on it.
- `note` is Send back's note, or the notes that went with an Accept or an Approve, in full. Notes
  pinned on a picture name the picture and the spot: `1. On the "after" picture, on a phone, 82%
  across and 41% down: The button is cut off here`.
- `repo` is the manifests' name for the repository (`arca`), not the full one.
- At most 20 presses and 20 sign-offs, and never more than 56 KB in all. When more are waiting,
  `more` is `true`: collect again.

### `press-result`

What happened to one press you collected. Send one for every press, never for a sign-off.

```json
{ "kind": "press-result", "id": "6f1c0a52-3b7e-4c1d-9a41-2f0e8c7d5b10", "outcome": "done", "message": "Made part of ARCA." }
```

`outcome` is `done`, `out-of-date` (the run was not waiting at the card any more) or `refused`.
`message` is needed, up to 1,000 characters, in plain words: the founder reads it on the card, after
the studio has removed any dollar figure, "What to do next" line or mention of Archon. The card then
shows it and has no buttons.

The same answer sent again is 200, so a retry is safe. A different answer for a press that already
has one is 409 and changes nothing. An id that is not a press, or is a sign-off, is 409.

### `answered-elsewhere`

A tap John made on Telegram, for a card the studio has. The studio keeps it as a press of its own,
already answered, and the card shows it and loses its buttons. It is never collected.

```json
{ "kind": "answered-elsewhere", "repo": "arca", "number": 21, "action": "approve", "at": "2026-11-04T09:18:00Z", "outcome": "done", "message": "Approved on Telegram." }
```

Needed: `repo`, `number` (as on a card; `venture` may be sent as a check), `action` (any press but
`accept`: Telegram has no sign-off) and `at` (when John tapped). Optional: `outcome` (`done` when left
out) and `message` (up to 1,000 characters; "Done on Telegram." or "Nothing was done." when left
out). The tap is John's.

The same tap (repository, number, action and `at`) sent again is 200 and kept once. Sent again with a
different answer it is 409. A card the studio does not have yet is 409: send the card first.

## Answers

Every answer but the first is JSON: `{ "ok": true|false, "message": "<a sentence>" }`. A `collect`
adds `presses`, `signOffs` and `more`.

| Status | Means | Do |
|---|---|---|
| 404, not JSON | the door is closed: no `FACTORY_DOOR_SECRET` is set on this studio | ask John to set one |
| 200 | kept | nothing |
| 400 | a field is wrong; the message names it | fix the sender |
| 401 | not signed, wrongly signed, or the timestamp is more than five minutes out | check the secret and the clock |
| 409 | a newer card is already here; or a picture, preview or tap for a card not sent yet, or a picture of another version; or a press id that is not a press, is a sign-off, or already has a different answer | send the card first, or drop it |
| 413 | too big | send less |
| 415 | the picture is not a PNG | send a PNG |
| 422 | no venture lists that repository (cowgate is the factory's, never refused for this), two do, the `venture` sent does not match, or the address is not a preview address | fix the manifest or the sender |
| 500, 503 | the studio could not keep it, or has no database | try again later; tell John if it lasts |
