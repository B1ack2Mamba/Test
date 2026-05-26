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

create table if not exists public.specialist_ai_chats (
  id uuid primary key default gen_random_uuid(),
  specialist_user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'deepseek' check (provider in ('openai', 'deepseek')),
  title text not null default 'Новый чат',
  last_provider text check (last_provider in ('openai', 'deepseek')),
  last_model text,
  last_user_message text not null default '',
  transcript jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.specialist_ai_chats
  add column if not exists transcript jsonb not null default '[]'::jsonb;

alter table public.specialist_ai_chats
  add column if not exists provider text not null default 'deepseek' check (provider in ('openai', 'deepseek'));

create table if not exists public.specialist_ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.specialist_ai_chats(id) on delete cascade,
  specialist_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  provider text check (provider in ('openai', 'deepseek')),
  model text,
  task_id uuid references public.specialist_ai_chat_tasks(id) on delete set null,
  status text not null default 'completed',
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.specialist_ai_chat_tasks
  add column if not exists chat_id uuid references public.specialist_ai_chats(id) on delete set null;

alter table public.specialist_ai_chat_tasks
  add column if not exists assistant_message_id uuid references public.specialist_ai_chat_messages(id) on delete set null;

create index if not exists specialist_ai_chat_tasks_user_created_idx
  on public.specialist_ai_chat_tasks(specialist_user_id, created_at desc);

create index if not exists specialist_ai_chat_tasks_response_idx
  on public.specialist_ai_chat_tasks(response_id)
  where response_id is not null;

create index if not exists specialist_ai_chats_user_updated_idx
  on public.specialist_ai_chats(specialist_user_id, updated_at desc);

create index if not exists specialist_ai_chats_user_provider_updated_idx
  on public.specialist_ai_chats(specialist_user_id, provider, updated_at desc);

create index if not exists specialist_ai_chat_messages_chat_created_idx
  on public.specialist_ai_chat_messages(chat_id, created_at asc);

create index if not exists specialist_ai_chat_messages_user_created_idx
  on public.specialist_ai_chat_messages(specialist_user_id, created_at desc);

alter table public.specialist_ai_chat_tasks enable row level security;
alter table public.specialist_ai_chats enable row level security;
alter table public.specialist_ai_chat_messages enable row level security;

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

drop policy if exists "specialist_ai_chats_select_own" on public.specialist_ai_chats;
create policy "specialist_ai_chats_select_own"
  on public.specialist_ai_chats for select
  using (auth.uid() = specialist_user_id);

drop policy if exists "specialist_ai_chats_insert_own" on public.specialist_ai_chats;
create policy "specialist_ai_chats_insert_own"
  on public.specialist_ai_chats for insert
  with check (auth.uid() = specialist_user_id);

drop policy if exists "specialist_ai_chats_update_own" on public.specialist_ai_chats;
create policy "specialist_ai_chats_update_own"
  on public.specialist_ai_chats for update
  using (auth.uid() = specialist_user_id)
  with check (auth.uid() = specialist_user_id);

drop policy if exists "specialist_ai_chats_delete_own" on public.specialist_ai_chats;
create policy "specialist_ai_chats_delete_own"
  on public.specialist_ai_chats for delete
  using (auth.uid() = specialist_user_id);

drop policy if exists "specialist_ai_chat_messages_select_own" on public.specialist_ai_chat_messages;
create policy "specialist_ai_chat_messages_select_own"
  on public.specialist_ai_chat_messages for select
  using (auth.uid() = specialist_user_id);

drop policy if exists "specialist_ai_chat_messages_insert_own" on public.specialist_ai_chat_messages;
create policy "specialist_ai_chat_messages_insert_own"
  on public.specialist_ai_chat_messages for insert
  with check (auth.uid() = specialist_user_id);

drop policy if exists "specialist_ai_chat_messages_update_own" on public.specialist_ai_chat_messages;
create policy "specialist_ai_chat_messages_update_own"
  on public.specialist_ai_chat_messages for update
  using (auth.uid() = specialist_user_id)
  with check (auth.uid() = specialist_user_id);

drop policy if exists "specialist_ai_chat_messages_delete_own" on public.specialist_ai_chat_messages;
create policy "specialist_ai_chat_messages_delete_own"
  on public.specialist_ai_chat_messages for delete
  using (auth.uid() = specialist_user_id);
