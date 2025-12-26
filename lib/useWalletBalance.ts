import { useMemo } from "react";
import { useWallet } from "@/lib/useWallet";

/**
 * Minimal wallet hook for pages that only need the current balance.
 *
 * NOTE: `userId` is intentionally accepted for backward-compatibility.
 * The underlying `useWallet()` already derives the user from `useSession()`.
 */
export function useWalletBalance(userId: string | null) {
  const { wallet, refresh, loading, error } = useWallet();

  const balance_rub = useMemo(() => {
    if (!userId) return 0;
    const kopeks = wallet?.balance_kopeks ?? 0;
    return Math.floor(kopeks / 100);
  }, [wallet?.balance_kopeks, userId]);

  return { balance_rub, refresh, loading, error };
}
