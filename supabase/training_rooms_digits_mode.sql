-- Migration: enable room-level training mode to show digits to participants

alter table public.training_rooms
  add column if not exists participants_can_see_digits boolean not null default false;
