-- The messages a founder gets about their team's work, and the founder's "stop these" (FB-279).
--
-- When the planning box sends a card that is `finished`, `stuck` or `sent-back`, the venture's
-- founder gets one message about it: a notification on their phone if one was delivered, an email
-- if not, never both. These two tables are what make it one, and what make "stop" stick.
--
--   `pushstore` — a store. Derived from nothing. **Never drop this.** (005's guarantee.) A lost
--   `card_messages` would send every card again; a lost `messages_off` would start messages a
--   founder had stopped.
--
-- ## card_messages: one row per message, written BEFORE anything is sent
--
-- The key is the card's version and its occasion: its repository, number, state, the commit it is
-- about, and `occasion`. The studio inserts the row first, and only the request whose insert went in
-- sends anything. So the box sending the same card again sends nothing, two copies arriving at once
-- send one message, and the same work finished again on a new commit sends one more.
--
--   `occasion` — '' for a finished card with a commit: one "finished" message per commit. For a
--                stuck or sent-back card, or a finished one with no commit, the time of the card's
--                last trail entry (or its `sentAt` if it has none). Each new event on the box adds a
--                trail entry, so a second "stuck" on the same commit is a new message, while the
--                same version sent again is not (`messageKey` in lib/founder-message.ts).
--   `outcome`  — `pending`: claimed, and not finished yet. `notification`: a phone took it.
--                `email`: no phone did, so it went by email. `none`: neither could be sent.
--                `off`: the founder had stopped these messages, so nothing was sent.
--                `given-up`: three tries, and none could send it. `outdated`: by the time it was
--                tried again, the card had moved on, so it was not sent.
--   `attempts`, `tried_at` — how many tries, and when the last began. A row left `pending` (the
--                studio stopped between the claim and the send) or `none` is tried again on a
--                heartbeat once its last try is ten minutes old, three tries in all.
--   `why`      — when nothing went, why, in plain words. Never an address or a secret.
--   `reported_at` — when the box was told this message was given up, so John hears of it once.
--
-- ## messages_off: a row means "stop"
--
-- Messages are on unless the founder has a row here. Per venture, because a founder of two
-- ventures may want one and not the other.
--
-- Both are scoped by venture with the same forced row-level security as every table here, so one
-- venture's message can never be claimed, or stopped, under another (CLAUDE.md #6).
--
-- Written so that loading it twice changes nothing, and so that loading it over the first version
-- of `card_messages` (which a preview may have put in staging's database) brings that one up to
-- this: each new column is added only if it is missing, and each rule is dropped by name and made
-- again.

create schema if not exists pushstore;

create table if not exists pushstore.card_messages (
  venture_id  text not null,
  repo        text not null,
  number      integer not null,
  state       text not null,
  head_sha    text not null,
  -- Who it was for: the manifest's founder at the time.
  email       text not null,
  outcome     text not null default 'pending',
  created_at  timestamptz not null default now()
);

alter table pushstore.card_messages add column if not exists occasion    text not null default '';
alter table pushstore.card_messages add column if not exists attempts    integer not null default 1;
alter table pushstore.card_messages add column if not exists tried_at    timestamptz not null default now();
alter table pushstore.card_messages add column if not exists why         text;
alter table pushstore.card_messages add column if not exists reported_at timestamptz;

-- The first version named these the way Postgres names a column's own check, so the same names
-- drop either version's.
alter table pushstore.card_messages drop constraint if exists card_messages_state_check;
alter table pushstore.card_messages add constraint card_messages_state_check
  check (state in ('finished', 'stuck', 'sent-back'));
alter table pushstore.card_messages drop constraint if exists card_messages_outcome_check;
alter table pushstore.card_messages add constraint card_messages_outcome_check
  check (outcome in ('pending', 'notification', 'email', 'none', 'off', 'given-up', 'outdated'));
alter table pushstore.card_messages drop constraint if exists card_messages_attempts_check;
alter table pushstore.card_messages add constraint card_messages_attempts_check check (attempts >= 1);
alter table pushstore.card_messages drop constraint if exists card_messages_pkey;
alter table pushstore.card_messages add constraint card_messages_pkey
  primary key (venture_id, repo, number, state, head_sha, occasion);

create table if not exists pushstore.messages_off (
  venture_id  text not null,
  email       text not null,
  since       timestamptz not null default now(),
  primary key (venture_id, email)
);

alter table pushstore.card_messages enable row level security;
alter table pushstore.messages_off  enable row level security;
-- FORCE, for 001's reason: without it the table owner bypasses the policy.
alter table pushstore.card_messages force row level security;
alter table pushstore.messages_off  force row level security;

drop policy if exists card_messages_scoped on pushstore.card_messages;
create policy card_messages_scoped on pushstore.card_messages
  using (venture_id = current_setting('app.venture_id', true))
  with check (venture_id = current_setting('app.venture_id', true));

drop policy if exists messages_off_scoped on pushstore.messages_off;
create policy messages_off_scoped on pushstore.messages_off
  using (venture_id = current_setting('app.venture_id', true))
  with check (venture_id = current_setting('app.venture_id', true));

-- A message is claimed and then marked with what happened, and tried again if it did not go; it is
-- never removed. Stopping messages is a row, and starting them again removes it.
grant usage on schema pushstore to foundry_studio;
grant select, insert, update on pushstore.card_messages to foundry_studio;
grant select, insert, delete on pushstore.messages_off to foundry_studio;

-- Recorded, so a deploy can tell production has this file (FB-287).
insert into foundry_meta.schema_files (name) values ('014_founder_messages.sql') on conflict (name) do nothing;
