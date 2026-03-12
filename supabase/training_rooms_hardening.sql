-- Additional indexes for training-room production hardening.
-- Safe to run multiple times.

create index if not exists training_room_members_user_room_idx
  on public.training_room_members(user_id, room_id);

create index if not exists training_room_members_room_role_last_seen_idx
  on public.training_room_members(room_id, role, last_seen desc);

create index if not exists training_progress_room_user_completed_idx
  on public.training_progress(room_id, user_id, completed_at desc);

create index if not exists training_progress_user_room_idx
  on public.training_progress(user_id, room_id);

create index if not exists training_progress_attempt_idx
  on public.training_progress(attempt_id)
  where attempt_id is not null;

create index if not exists training_attempts_user_room_created_idx
  on public.training_attempts(user_id, room_id, created_at desc);

create index if not exists training_attempts_room_user_test_created_idx
  on public.training_attempts(room_id, user_id, test_slug, created_at desc);
