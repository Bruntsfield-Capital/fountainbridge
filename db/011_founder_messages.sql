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
-- The key is the card's version: its repository, number, state and the commit it is about. The
-- studio inserts the row first, and only the request whose insert went in sends anything. So the box
-- sending the same card again sends nothing, two copies arriving at once send one message, and the
-- same work finished again on a new commit sends one more. A row left `pending` is a message the
-- studio meant to send and did not finish: it is never tried again, so nothing can go twice.
--
--   `outcome` — `notification`: a phone took it. `email`: no phone did, so it went by email.
--               `none`: neither could be sent (the log says why). `off`: the founder had stopped
--               these messages, so nothing was sent.
--
-- ## messages_off: a row means "stop"
--
-- Messages are on unless the founder has a row here. Per venture, because a founder of two
-- ventures may want one and not the other.
--
-- Both are scoped by venture with the same forced row-level security as every table here, so one
-- venture's message can never be claimed, or stopped, under another (CLAUDE.md #6).
--
-- Written so that loading it twice changes nothing.

create schema if not exists pushstore;

create table if not exists pushstore.card_messages (
  venture_id  text not null,
  repo        text not null,
  number      integer not null,
  state       text not null check (state in ('finished', 'stuck', 'sent-back')),
  head_sha    text not null,
  -- Who it was for: the manifest's founder at the time.
  email       text not null,
  outcome     text not null default 'pending'
              check (outcome in ('pending', 'notification', 'email', 'none', 'off')),
  created_at  timestamptz not null default now(),
  primary key (venture_id, repo, number, state, head_sha)
);

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

-- A message is claimed and then marked with what happened; it is never removed. Stopping messages
-- is a row, and starting them again removes it.
grant usage on schema pushstore to foundry_studio;
grant select, insert, update on pushstore.card_messages to foundry_studio;
grant select, insert, delete on pushstore.messages_off to foundry_studio;
