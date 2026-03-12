create table if not exists public.training_room_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.training_rooms(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'participant',
  display_name text,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists training_room_sessions_room_user_idx
  on public.training_room_sessions(room_id, user_id);

create index if not exists training_room_sessions_expires_idx
  on public.training_room_sessions(expires_at);

create index if not exists training_room_sessions_user_idx
  on public.training_room_sessions(user_id);
