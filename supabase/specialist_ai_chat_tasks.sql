create table if not exists public.specialist_ai_chat_tasks (
  id uuid primary key default gen_random_uuid(),
  specialist_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'deepseek')),
  model text not null,
  response_id text,
  status text not null default 'queued',
  request_messages jsonb not null default '[]'::jsonb,
  result_text text not null default '',
  error_text text not null default '',
  temperature numeric not null default 0.3,
  max_output_tokens integer not null default 3000,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists specialist_ai_chat_tasks_user_created_idx
  on public.specialist_ai_chat_tasks(specialist_user_id, created_at desc);

create index if not exists specialist_ai_chat_tasks_response_idx
  on public.specialist_ai_chat_tasks(response_id)
  where response_id is not null;

alter table public.specialist_ai_chat_tasks enable row level security;

drop policy if exists "specialist_ai_chat_tasks_select_own" on public.specialist_ai_chat_tasks;
create policy "specialist_ai_chat_tasks_select_own"
  on public.specialist_ai_chat_tasks for select
  using (auth.uid() = specialist_user_id);

drop policy if exists "specialist_ai_chat_tasks_insert_own" on public.specialist_ai_chat_tasks;
create policy "specialist_ai_chat_tasks_insert_own"
  on public.specialist_ai_chat_tasks for insert
  with check (auth.uid() = specialist_user_id);

drop policy if exists "specialist_ai_chat_tasks_update_own" on public.specialist_ai_chat_tasks;
create policy "specialist_ai_chat_tasks_update_own"
  on public.specialist_ai_chat_tasks for update
  using (auth.uid() = specialist_user_id)
  with check (auth.uid() = specialist_user_id);

drop policy if exists "specialist_ai_chat_tasks_delete_own" on public.specialist_ai_chat_tasks;
create policy "specialist_ai_chat_tasks_delete_own"
  on public.specialist_ai_chat_tasks for delete
  using (auth.uid() = specialist_user_id);
