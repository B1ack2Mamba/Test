import { useMemo } from "react";
import { useWallet } from "@/lib/useWallet";

/**
 * Minimal wallet hook for pages that only need the current balance.
 *
 * NOTE: `userId` is accepted only for backward-compatibility.
 * The underlying `useWallet()` already derives the user from `useSession()`.
 */
export function useWalletBalance(_userId: string | null = null) {
  const { wallet, refresh, loading, error } = useWallet();

  const balance_rub = useMemo(() => {
    const kopeks = wallet?.balance_kopeks ?? 0;
    return Math.floor(kopeks / 100);
  }, [wallet?.balance_kopeks]);

  // Provide both snake_case and camelCase for old/new code paths.
  return { balance_rub, balanceRub: balance_rub, refresh, loading, error };
}
