alter table if exists public.training_rooms
  add column if not exists group_analysis_prompt text;
