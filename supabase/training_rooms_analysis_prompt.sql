-- Adds a room-level custom prompt for generating a full AI portrait of a participant.

alter table public.training_rooms
  add column if not exists analysis_prompt text;
