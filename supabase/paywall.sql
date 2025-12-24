-- Paywall + wallet schema for tests-platform
--
-- Tables:
-- - public.wallets (internal balance)
-- - public.wallet_ledger (audit trail)
-- - public.test_unlocks (which user unlocked which test interpretation)
-- - public.test_interpretations (protected interpretation content)
--
-- RPC:
-- - public.unlock_test(p_test_slug text, p_price_kopeks bigint)
--
-- SECURITY MODEL
-- - Client uses publishable/anon key + RLS.
-- - Users can read: their own wallet, ledger, and unlocks.
-- - Users cannot directly edit balances or create unlocks.
-- - Unlocking is done through a SECURITY DEFINER function that performs
--   validation, balance checks and atomic updates.

-- Wallets (one row per user)
create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance_kopeks bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Ledger (audit trail)
create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_kopeks bigint not null,
  reason text not null,
  ref text,
  created_at timestamptz not null default now()
);

create index if not exists wallet_ledger_user_created_at_idx
  on public.wallet_ledger(user_id, created_at desc);

-- Interpretation content (protected)
create table if not exists public.test_interpretations (
  test_slug text primary key references public.tests(slug) on delete cascade,
  content jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Unlocked interpretations (one row per user+test)
create table if not exists public.test_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  test_slug text not null references public.tests(slug) on delete cascade,
  price_kopeks bigint not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, test_slug)
);

create index if not exists test_unlocks_test_slug_idx
  on public.test_unlocks(test_slug);

-- RLS
alter table public.wallets enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.test_interpretations enable row level security;
alter table public.test_unlocks enable row level security;

-- wallets: users can read their own wallet
drop policy if exists "Wallets: read own" on public.wallets;
create policy "Wallets: read own"
  on public.wallets
  for select
  using (auth.uid() = user_id);

-- wallets: users can create their own wallet row but only with 0 balance
drop policy if exists "Wallets: insert own (0 balance)" on public.wallets;
create policy "Wallets: insert own (0 balance)"
  on public.wallets
  for insert
  with check (auth.uid() = user_id and balance_kopeks = 0);

-- wallet_ledger: users can read their own ledger
drop policy if exists "Ledger: read own" on public.wallet_ledger;
create policy "Ledger: read own"
  on public.wallet_ledger
  for select
  using (auth.uid() = user_id);

-- test_unlocks: users can read their own unlocks
drop policy if exists "Unlocks: read own" on public.test_unlocks;
create policy "Unlocks: read own"
  on public.test_unlocks
  for select
  using (auth.uid() = user_id);

-- test_interpretations: users can read only if unlocked
drop policy if exists "Interpretations: read if unlocked" on public.test_interpretations;
create policy "Interpretations: read if unlocked"
  on public.test_interpretations
  for select
  using (
    exists (
      select 1
      from public.test_unlocks u
      where u.user_id = auth.uid()
        and u.test_slug = public.test_interpretations.test_slug
    )
  );

-- Unlock RPC (atomic charge + unlock)
create or replace function public.unlock_test(p_test_slug text, p_price_kopeks bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_price_rub integer;
  v_price_kopeks bigint;
  v_balance bigint;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Must have an interpretation row, otherwise we don't charge.
  if not exists (select 1 from public.test_interpretations i where i.test_slug = p_test_slug) then
    raise exception 'No interpretation for this test';
  end if;

  select t.price_rub into v_price_rub
  from public.tests t
  where t.slug = p_test_slug
    and t.is_published = true;

  if not found then
    raise exception 'Test not found';
  end if;

  v_price_kopeks := (v_price_rub::bigint) * 100;

  if v_price_kopeks <= 0 then
    raise exception 'This test does not require payment';
  end if;

  -- Basic tamper check from client UI (optional)
  if p_price_kopeks is not null and p_price_kopeks <> v_price_kopeks then
    raise exception 'Price mismatch';
  end if;

  -- Idempotent: if already unlocked, do nothing
  if exists (select 1 from public.test_unlocks u where u.user_id = v_uid and u.test_slug = p_test_slug) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- Ensure wallet exists
  insert into public.wallets(user_id, balance_kopeks)
  values (v_uid, 0)
  on conflict (user_id) do nothing;

  -- Lock wallet row and check balance
  select w.balance_kopeks into v_balance
  from public.wallets w
  where w.user_id = v_uid
  for update;

  if v_balance < v_price_kopeks then
    raise exception 'Insufficient balance';
  end if;

  update public.wallets
  set balance_kopeks = balance_kopeks - v_price_kopeks,
      updated_at = now()
  where user_id = v_uid;

  insert into public.wallet_ledger(user_id, amount_kopeks, reason, ref)
  values (v_uid, -v_price_kopeks, 'unlock', 'test:' || p_test_slug);

  insert into public.test_unlocks(user_id, test_slug, price_kopeks)
  values (v_uid, p_test_slug, v_price_kopeks);

  return jsonb_build_object('ok', true, 'charged_kopeks', v_price_kopeks);
end;
$$;

revoke all on function public.unlock_test(text, bigint) from public;
grant execute on function public.unlock_test(text, bigint) to authenticated;

-- Admin/server top-up helper.
-- Intended usage: webhook/payment handler credits user's internal wallet.
create or replace function public.credit_wallet(
  p_user_id uuid,
  p_amount_kopeks bigint,
  p_reason text default 'topup',
  p_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance bigint;
begin
  if p_amount_kopeks is null or p_amount_kopeks <= 0 then
    raise exception 'Amount must be positive';
  end if;

  insert into public.wallets(user_id, balance_kopeks)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update public.wallets
  set balance_kopeks = balance_kopeks + p_amount_kopeks,
      updated_at = now()
  where user_id = p_user_id
  returning balance_kopeks into v_new_balance;

  insert into public.wallet_ledger(user_id, amount_kopeks, reason, ref)
  values (p_user_id, p_amount_kopeks, coalesce(p_reason,'topup'), p_ref);

  return jsonb_build_object('ok', true, 'balance_kopeks', v_new_balance);
end;
$$;

revoke all on function public.credit_wallet(uuid, bigint, text, text) from public;
-- Only server (service role) should call this.
grant execute on function public.credit_wallet(uuid, bigint, text, text) to service_role;
