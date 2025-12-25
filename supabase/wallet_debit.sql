-- Wallet debit helper (pay-per-use)
--
-- Adds RPC:
--   public.debit_wallet(p_user_id uuid, p_amount_kopeks bigint, p_reason text, p_ref text)
--
-- Used by server routes to charge the internal wallet for:
-- - author interpretation (99₽)
-- - AI interpretation (49₽)
--
-- IMPORTANT: granted only to service_role (server-side). Do NOT expose to client keys.

create or replace function public.debit_wallet(
  p_user_id uuid,
  p_amount_kopeks bigint,
  p_reason text default 'debit',
  p_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_new_balance bigint;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;
  if p_amount_kopeks is null or p_amount_kopeks <= 0 then
    raise exception 'Amount must be positive';
  end if;

  insert into public.wallets(user_id, balance_kopeks)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select w.balance_kopeks into v_balance
  from public.wallets w
  where w.user_id = p_user_id
  for update;

  if v_balance < p_amount_kopeks then
    raise exception 'Insufficient balance';
  end if;

  update public.wallets
  set balance_kopeks = balance_kopeks - p_amount_kopeks,
      updated_at = now()
  where user_id = p_user_id
  returning balance_kopeks into v_new_balance;

  insert into public.wallet_ledger(user_id, amount_kopeks, reason, ref)
  values (p_user_id, -p_amount_kopeks, coalesce(p_reason,'debit'), p_ref);

  return jsonb_build_object('ok', true, 'balance_kopeks', v_new_balance, 'charged_kopeks', p_amount_kopeks);
end;
$$;

revoke all on function public.debit_wallet(uuid, bigint, text, text) from public;
grant execute on function public.debit_wallet(uuid, bigint, text, text) to service_role;
