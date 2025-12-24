-- Supabase schema for tests-platform (MVP)
-- Table: public.tests stores the full test JSON (forced_pair_v1) in jsonb.

create extension if not exists pgcrypto;

create table if not exists public.tests (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  description text,
  type text not null,
  json jsonb not null,
  price_rub integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at auto-touch
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_tests_updated_at on public.tests;
create trigger trg_tests_updated_at
before update on public.tests
for each row execute function public.set_updated_at();

-- RLS: allow public to read published tests only.
alter table public.tests enable row level security;

drop policy if exists "Public read published tests" on public.tests;
create policy "Public read published tests"
  on public.tests
  for select
  using (is_published = true);

-- Notes:
-- - Do NOT create insert/update policies for anon/publishable keys.
-- - For admin uploads, use SUPABASE_SERVICE_ROLE_KEY in a server route.
