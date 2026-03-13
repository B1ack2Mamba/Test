# Pre-production checklist

## Before launch
- Apply SQL migrations in order:
  1. `supabase/training_room_sessions.sql`
  2. `supabase/training_rooms_personal_data_consent.sql`
  3. `supabase/training_rooms_hardening.sql`
- Verify `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- Verify `DEEPSEEK_API_KEY` if AI interpretations are enabled
- Smoke test participant flow:
  - open room list
  - join room
  - open room directly after browser back
  - complete one test
  - open next test
- Smoke test specialist flow:
  - open room dashboard
  - view participant results
  - export Excel
- Check legal pages:
  - `/legal/privacy`
  - `/legal/personal-data-consent`
- Check that room password change still works
- Check that all required tests are enabled in room settings

## Load sanity
- Test at least 20 parallel participants in staging/local tunnel
- Then test 50 participants if possible
- AI generation should be tested separately from mass participant sessions

## Release notes
- Room access now uses server-side room session cookie
- Participant bootstrap uses one request instead of several sequential ones
- Sensitive participant endpoints are marked `no-store`
- Duplicate submit is ignored and returns the existing attempt id
