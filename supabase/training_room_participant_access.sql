create table if not exists public.training_room_participant_access (
  room_id uuid not null references public.training_rooms(id) on delete cascade,
  user_id uuid not null,
  display_name text,
  access_code text not null,
  access_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  primary key (room_id, user_id)
);

create unique index if not exists training_room_participant_access_code_uidx
  on public.training_room_participant_access (room_id, access_code);

create unique index if not exists training_room_participant_access_token_uidx
  on public.training_room_participant_access (room_id, access_token_hash);

create index if not exists training_room_participant_access_last_used_idx
  on public.training_room_participant_access (room_id, last_used_at desc);
