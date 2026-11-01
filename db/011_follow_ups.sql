-- John keeps Reject and Try again after a founder's Send back (FB-286; John, 30 October 2026).
--
-- Once the box has done a founder's Send back, it stands on the card, and the card takes no other
-- press, except John's Reject or Try again: that press follows the Send back up (`placeFor` in
-- lib/presses.ts). The studio marks it with `follows_up` when it writes it.
--
--   `follows_up` — true for John's Reject or Try again written over a founder's Send back the box
--                  did. False for every other press.
--
-- `presses_one_standing` (009, 010) allowed one standing press per version of a card. It now
-- allows one of each kind: one first press, and one follow-up. So a second follow-up, like a second
-- first press, cannot be written even if two arrive at the same moment. The check says only John's
-- Reject or Try again can be a follow-up, whatever the studio sends.
--
-- The studio's role may insert the new column already: 009 grants insert on the whole table.
--
-- Written so that loading it twice changes nothing.

alter table factorystore.presses add column if not exists follows_up boolean not null default false;

alter table factorystore.presses drop constraint if exists presses_follow_up_is_johns;
alter table factorystore.presses add constraint presses_follow_up_is_johns
  check (not follows_up or (by_john and action in ('reject', 'try-again')));

drop index if exists factorystore.presses_one_standing;
create unique index if not exists presses_one_standing
  on factorystore.presses (venture_id, repo, number, seen_head_sha, follows_up)
  where source = 'studio' and action <> 'accept' and lapsed_at is null and (outcome is null or outcome = 'done');
