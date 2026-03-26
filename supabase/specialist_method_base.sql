create table if not exists public.specialist_method_links (
  id uuid primary key default gen_random_uuid(),
  specialist_user_id uuid not null,
  title text not null default '',
  ai_task text not null default '',
  ai_draft text not null default '',
  final_text text not null default '',
  item_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists specialist_method_links_user_updated_idx
  on public.specialist_method_links(specialist_user_id, updated_at desc);

create table if not exists public.specialist_method_link_items (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.specialist_method_links(id) on delete cascade,
  specialist_user_id uuid not null,
  sort_order integer not null default 0,
  test_slug text not null,
  test_title text not null default '',
  result_key text not null,
  result_label text not null,
  answer_value text not null default '',
  answer_note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists specialist_method_link_items_link_sort_idx
  on public.specialist_method_link_items(link_id, sort_order asc);

create index if not exists specialist_method_link_items_user_idx
  on public.specialist_method_link_items(specialist_user_id);

alter table public.specialist_method_links enable row level security;
alter table public.specialist_method_link_items enable row level security;

drop policy if exists "specialist_method_links_select_own" on public.specialist_method_links;
create policy "specialist_method_links_select_own"
  on public.specialist_method_links for select
  using (auth.uid() = specialist_user_id);

drop policy if exists "specialist_method_links_insert_own" on public.specialist_method_links;
create policy "specialist_method_links_insert_own"
  on public.specialist_method_links for insert
  with check (auth.uid() = specialist_user_id);

drop policy if exists "specialist_method_links_update_own" on public.specialist_method_links;
create policy "specialist_method_links_update_own"
  on public.specialist_method_links for update
  using (auth.uid() = specialist_user_id)
  with check (auth.uid() = specialist_user_id);

drop policy if exists "specialist_method_links_delete_own" on public.specialist_method_links;
create policy "specialist_method_links_delete_own"
  on public.specialist_method_links for delete
  using (auth.uid() = specialist_user_id);

drop policy if exists "specialist_method_link_items_select_own" on public.specialist_method_link_items;
create policy "specialist_method_link_items_select_own"
  on public.specialist_method_link_items for select
  using (auth.uid() = specialist_user_id);

drop policy if exists "specialist_method_link_items_insert_own" on public.specialist_method_link_items;
create policy "specialist_method_link_items_insert_own"
  on public.specialist_method_link_items for insert
  with check (auth.uid() = specialist_user_id);

drop policy if exists "specialist_method_link_items_update_own" on public.specialist_method_link_items;
create policy "specialist_method_link_items_update_own"
  on public.specialist_method_link_items for update
  using (auth.uid() = specialist_user_id)
  with check (auth.uid() = specialist_user_id);

drop policy if exists "specialist_method_link_items_delete_own" on public.specialist_method_link_items;
create policy "specialist_method_link_items_delete_own"
  on public.specialist_method_link_items for delete
  using (auth.uid() = specialist_user_id);
