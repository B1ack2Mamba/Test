import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/useSession";

export type WalletRow = {
  user_id: string;
  balance_kopeks: number;
  updated_at?: string;
};

export type LedgerRow = {
  id: string;
  created_at: string;
  amount_kopeks: number;
  reason: string;
  ref: string | null;
};

export function formatRub(kopeks: number): string {
  const rub = Math.floor(Math.abs(kopeks) / 100);
  const sign = kopeks < 0 ? "-" : "";
  return `${sign}${rub} ₽`;
}

export function useWallet() {
  const { supabase, user } = useSession();
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const refresh = useCallback(async () => {
    if (!supabase || !user) {
      setWallet(null);
      setLedger([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Ensure wallet exists.
      // IMPORTANT: do NOT allow client-side updates of the balance.
      // We only insert the row if missing.
      await supabase
        .from("wallets")
        .upsert(
          { user_id: user.id, balance_kopeks: 0 },
          { onConflict: "user_id", ignoreDuplicates: true }
        );

      const w = await supabase.from("wallets").select("user_id,balance_kopeks,updated_at").eq("user_id", user.id).single();
      if (w.error) throw w.error;
      setWallet(w.data as any);

      const l = await supabase
        .from("wallet_ledger")
        .select("id,created_at,amount_kopeks,reason,ref")
        .order("created_at", { ascending: false })
        .limit(20);
      if (l.error) throw l.error;
      setLedger((l.data ?? []) as any);
    } catch (e: any) {
      setError(e?.message ?? "Wallet load error");
    } finally {
      setLoading(false);
    }
  }, [supabase, user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { wallet, ledger, loading, error, refresh };
}
