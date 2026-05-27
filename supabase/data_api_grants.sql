-- Explicit Data API grants for Supabase public schema tables.
-- Safe to run multiple times and safe when some optional tables are absent.
--
-- Supabase is moving new public tables to explicit Data API exposure.
-- Keep RLS as the row-level guard, and grant only the roles the app uses.

grant usage on schema public to anon, authenticated, service_role;

do $$
begin
  -- Public test catalog. Anonymous users can load published tests through RLS.
  if to_regclass('public.tests') is not null then
    execute 'revoke all privileges on table public.tests from anon, authenticated';
    execute 'grant select on table public.tests to anon, authenticated';
    execute 'grant all privileges on table public.tests to service_role';
  end if;

  -- Client-side wallet reads/creation. RLS keeps users scoped to their own rows.
  if to_regclass('public.wallets') is not null then
    execute 'revoke all privileges on table public.wallets from anon, authenticated';
    execute 'grant select, insert on table public.wallets to authenticated';
    execute 'grant all privileges on table public.wallets to service_role';
  end if;

  if to_regclass('public.wallet_ledger') is not null then
    execute 'revoke all privileges on table public.wallet_ledger from anon, authenticated';
    execute 'grant select on table public.wallet_ledger to authenticated';
    execute 'grant all privileges on table public.wallet_ledger to service_role';
  end if;

  if to_regclass('public.test_unlocks') is not null then
    execute 'revoke all privileges on table public.test_unlocks from anon, authenticated';
    execute 'grant select on table public.test_unlocks to authenticated';
    execute 'grant all privileges on table public.test_unlocks to service_role';
  end if;

  if to_regclass('public.test_interpretations') is not null then
    execute 'revoke all privileges on table public.test_interpretations from anon, authenticated';
    execute 'grant select on table public.test_interpretations to authenticated';
    execute 'grant all privileges on table public.test_interpretations to service_role';
  end if;

  if to_regclass('public.yookassa_topups') is not null then
    execute 'revoke all privileges on table public.yookassa_topups from anon, authenticated';
    execute 'grant select on table public.yookassa_topups to authenticated';
    execute 'grant all privileges on table public.yookassa_topups to service_role';
  end if;
end $$;

do $$
declare
  tbl text;
  server_only_tables text[] := array[
    'public.auth_name_logins',
    'public.training_rooms',
    'public.training_room_members',
    'public.training_progress',
    'public.training_attempts',
    'public.training_attempt_interpretations',
    'public.training_self_unlocks',
    'public.training_room_join_queue',
    'public.training_room_sessions',
    'public.training_room_participant_access',
    'public.training_room_tests',
    'public.specialist_method_links',
    'public.specialist_method_link_items',
    'public.specialist_ai_chat_tasks',
    'public.specialist_ai_chats',
    'public.specialist_ai_chat_messages'
  ];
begin
  -- Server-only tables. All access goes through Next.js API routes using service_role.
  -- Revoke direct client Data API access, including on older projects with legacy defaults.
  foreach tbl in array server_only_tables loop
    if to_regclass(tbl) is not null then
      execute format('revoke all privileges on table %s from anon, authenticated', tbl);
      execute format('grant all privileges on table %s to service_role', tbl);
    end if;
  end loop;

  -- These legacy helper tables were intentionally server-only but did not all
  -- have RLS enabled in their original migrations. Enabling RLS is safe for
  -- service_role-backed API routes and protects legacy projects from direct reads.
  foreach tbl in array array[
    'public.training_room_join_queue',
    'public.training_room_sessions',
    'public.training_room_participant_access'
  ] loop
    if to_regclass(tbl) is not null then
      execute format('alter table %s enable row level security', tbl);
    end if;
  end loop;
end $$;

do $$
begin
  -- RPC grants used by the app.
  if to_regprocedure('public.unlock_test(text,bigint)') is not null then
    execute 'revoke all on function public.unlock_test(text, bigint) from public';
    execute 'grant execute on function public.unlock_test(text, bigint) to authenticated';
  end if;

  if to_regprocedure('public.credit_wallet(uuid,bigint,text,text)') is not null then
    execute 'revoke all on function public.credit_wallet(uuid, bigint, text, text) from public';
    execute 'grant execute on function public.credit_wallet(uuid, bigint, text, text) to service_role';
  end if;

  if to_regprocedure('public.debit_wallet(uuid,bigint,text,text)') is not null then
    execute 'revoke all on function public.debit_wallet(uuid, bigint, text, text) from public';
    execute 'grant execute on function public.debit_wallet(uuid, bigint, text, text) to service_role';
  end if;
end $$;
