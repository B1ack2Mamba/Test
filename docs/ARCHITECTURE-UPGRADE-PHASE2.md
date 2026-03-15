# Phase 2 — lightweight participant cabinet

This phase adds a participant cabinet without mandatory registration:

- room participant receives access code + personal restore link after entering a room
- participant can restore access from another device using the saved link or code
- participant results page shows an overall portrait at the top and per-test results below
- room page now works without global auth as long as room session is present (or participant enters the room directly)

## Routes
- `/training/access?room_id=<id>&token=<token>` — restore access from personal link
- `/training/participant/results?room_id=<id>` — participant cabinet

## SQL
Apply:
- `supabase/training_room_participant_access.sql`
