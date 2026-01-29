-- Training rooms / live sessions (for workshops / тренинги)
-- Server-only access (no RLS policies for anon/auth). All reads/writes go through Next.js API using service_role.
-- Goal:
-- - Specialist creates a room with name + password
-- - Participants join with password + display name
-- - Participants take tests inside a room; they DO NOT see numeric results
-- - Specialist sees participants online + completion status + numeric results + can generate AI interpretation for free

create table if not exists public.training_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  password_hash text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_by_email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists training_rooms_active_created_at_idx
  on public.training_rooms(is_active, created_at desc);

create table if not exists public.training_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.training_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('participant','specialist')),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique(room_id, user_id)
);

create index if not exists training_room_members_room_last_seen_idx
  on public.training_room_members(room_id, last_seen desc);

-- Per-user per-test status in a room (safe to show even to participants, but we keep it server-only too for simplicity)
create table if not exists public.training_progress (
  room_id uuid not null references public.training_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  test_slug text not null references public.tests(slug) on delete cascade,
  started_at timestamptz,
  completed_at timestamptz,
  attempt_id uuid,
  primary key (room_id, user_id, test_slug)
);

create index if not exists training_progress_room_completed_idx
  on public.training_progress(room_id, completed_at desc);

-- Full attempts with numeric results (specialist-only)
create table if not exists public.training_attempts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.training_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  test_slug text not null references public.tests(slug) on delete cascade,
  answers jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists training_attempts_room_test_created_idx
  on public.training_attempts(room_id, test_slug, created_at desc);

-- AI interpretation generated from "keys" (test_interpretations) for workshop analysis (specialist-only, free)
create table if not exists public.training_attempt_interpretations (
  attempt_id uuid not null references public.training_attempts(id) on delete cascade,
  kind text not null,
  text text not null,
  created_at timestamptz not null default now(),
  primary key (attempt_id, kind)
);

-- Optional: expensive self-unlock for a participant (discouraging early self-interpretation)
create table if not exists public.training_self_unlocks (
  attempt_id uuid not null references public.training_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  paid_kopeks bigint not null,
  unlocked_at timestamptz not null default now(),
  primary key (attempt_id, user_id)
);

alter table public.training_rooms enable row level security;
alter table public.training_room_members enable row level security;
alter table public.training_progress enable row level security;
alter table public.training_attempts enable row level security;
alter table public.training_attempt_interpretations enable row level security;
alter table public.training_self_unlocks enable row level security;

-- IMPORTANT:
-- No policies are created. Client keys cannot read/write these tables directly.
-- Server routes use service_role and bypass RLS.
