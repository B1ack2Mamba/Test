-- Room-specific enabled tests + ordering
-- Server-only access through Next.js API using service_role (no RLS policies).

create table if not exists public.training_room_tests (
  room_id uuid not null references public.training_rooms(id) on delete cascade,
  test_slug text not null references public.tests(slug) on delete cascade,
  is_enabled boolean not null default true,
  sort_order integer not null default 0,
  required boolean not null default false,
  deadline_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, test_slug)
);

create index if not exists training_room_tests_room_enabled_sort_idx
  on public.training_room_tests(room_id, is_enabled, sort_order);

-- updated_at auto-touch (function set_updated_at() is defined in supabase/schema.sql)
drop trigger if exists trg_training_room_tests_updated_at on public.training_room_tests;
create trigger trg_training_room_tests_updated_at
before update on public.training_room_tests
for each row execute function public.set_updated_at();
