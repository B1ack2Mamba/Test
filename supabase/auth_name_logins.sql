-- Name-based auth mapping for participant login by first name + last name.
create table if not exists public.auth_name_logins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  normalized_name text not null unique,
  display_name text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.auth_name_logins enable row level security;

do $$
begin
  create policy "auth_name_logins_select_own"
  on public.auth_name_logins
  for select
  using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;
