# Architecture upgrade phase 1

This release focuses on the first four production-hardening priorities:

1. Make room join safer under load.
2. Prepare the product for lightweight participants (without bloating Supabase Auth).
3. Fix explicit product limits for room size.
4. Make the specialist room usable for large rooms.

## What is already implemented

- Join queue + throttling under load.
- Product room limits via environment:
  - `TRAINING_ROOM_PARTICIPANT_SOFT_LIMIT` (default 150)
  - `TRAINING_ROOM_PARTICIPANT_HARD_LIMIT` (default 250)
- Specialist dashboard pagination and search for participants.
- Large room UX warning in specialist room.

## Why lightweight participants are staged

The current schema stores participant activity in tables keyed by `user_id uuid references auth.users(id)`.
A full removal of participant traffic from Supabase Auth requires a dual-identity migration across:

- `training_room_members`
- `training_progress`
- `training_attempts`
- `training_room_sessions`
- related joins in specialist and participant APIs

That change is intentionally staged into a dedicated follow-up release so production traffic is not broken during the migration.

## Recommended next phase

- add `participant_uid` columns and backfill
- dual-read / dual-write period
- switch participant `join/bootstrap/touch/submit` to `participant_uid + signed room session`
- stop creating auth users for room participants
