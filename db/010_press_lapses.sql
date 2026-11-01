-- A press the factory never answers (FB-278).
--
-- The box has 10 minutes to collect a press, and 10 more after it collected it to say what
-- happened (`LAPSE_MS` in lib/presses.ts). A press that runs out of either has lapsed: the card shows
-- "Nothing was done." and takes a new press. The studio works that out from the times whenever it
-- reads the press. It stores no answer, so if the box's real answer arrives later it is kept, and
-- the card shows it.
--
-- `presses_one_standing` (009) cannot see time passing: an index may only use what never changes,
-- and "10 minutes ago" changes. So when a new press is written on a card whose press has lapsed,
-- the studio marks the old one with `lapsed_at` in the same transaction (`PRESS_SQL.lapse` in
-- lib/press-store.ts), and the index counts only presses that are not marked.
--
-- So a marked press the box answers `done` late is not counted by the index, and a card can then
-- hold two presses the box did. That is kept on purpose: the box did both, and refusing its answer
-- would hide what it did. The card shows the later (`stateFrom` in lib/review.ts), and `standing`
-- counts any `done`, so nothing more is taken on that card.
--
--   `lapsed_at` — when a later press took the place of this one, after it had lapsed. Empty for
--                 every other press. It is not an answer: it says nothing about what the box did.
--
-- Written so that loading it twice changes nothing.

alter table factorystore.presses add column if not exists lapsed_at timestamptz;

drop index if exists factorystore.presses_one_standing;
create unique index if not exists presses_one_standing
  on factorystore.presses (venture_id, repo, number, seen_head_sha)
  where source = 'studio' and action <> 'accept' and lapsed_at is null and (outcome is null or outcome = 'done');

grant update (lapsed_at) on factorystore.presses to foundry_studio;
