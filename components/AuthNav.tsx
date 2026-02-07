import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/useSession";

export function AuthNav() {
  const { supabase, session, user, envOk } = useSession();
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    setEmail(user?.email ?? "");
  }, [user]);

  if (!envOk) {
    return <span className="text-xs text-slate-500">Supabase не настроен</span>;
  }

  if (!session || !user) {
    return (
      <Link
        href="/auth"
        className="btn btn-secondary btn-sm"
      >
        Вход
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden max-w-40 truncate text-xs text-slate-500 sm:inline">
        {email || user.id}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!supabase) return;
          setBusy(true);
          try {
            await supabase.auth.signOut();
          } finally {
            setBusy(false);
          }
        }}
        className="btn btn-secondary btn-sm"
      >
        Выйти
      </button>
    </div>
  );
}
