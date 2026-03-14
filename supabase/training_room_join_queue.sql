create table if not exists public.training_room_join_queue (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.training_rooms(id) on delete cascade,
  queue_token text not null unique,
  display_name text,
  status text not null default 'queued' check (status in ('queued','admitted','completed','failed','cancelled')),
  created_at timestamptz not null default now(),
  admitted_at timestamptz,
  completed_at timestamptz,
  last_seen_at timestamptz not null default now(),
  error_message text
);

create index if not exists idx_training_room_join_queue_room_status_created
  on public.training_room_join_queue(room_id, status, created_at);

create index if not exists idx_training_room_join_queue_room_completed
  on public.training_room_join_queue(room_id, completed_at, created_at);
