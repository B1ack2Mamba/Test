-- YooKassa (SBP QR) integration helpers
--
-- This adds:
-- - public.yookassa_topups: store payment statuses for visibility
-- - unique index on wallet_ledger(user_id, ref) to make top-ups idempotent

create table if not exists public.yookassa_topups (
  payment_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_kopeks bigint not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- Users can read only their own top-ups (optional)
alter table public.yookassa_topups enable row level security;

drop policy if exists "YooKassa topups: read own" on public.yookassa_topups;
create policy "YooKassa topups: read own"
  on public.yookassa_topups
  for select
  using (auth.uid() = user_id);

-- Idempotency: prevent double credits for the same ref per user.
-- We use ref like "yookassa:<paymentId>" and also "test:<slug>" for unlocks.
create unique index if not exists wallet_ledger_user_ref_unique
  on public.wallet_ledger(user_id, ref)
  where ref is not null;
