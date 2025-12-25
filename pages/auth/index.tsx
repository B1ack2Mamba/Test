import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";

export default function AuthPage() {
  const { supabase, user, session } = useSession();
  const router = useRouter();
  const next = useMemo(() => {
    const n = router.query.next;
    return typeof n === "string" ? n : "/";
  }, [router.query.next]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user && session) {
      router.replace(next);
    }
  }, [user, session, next, router]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      // редирект произойдёт в useEffect
    } catch (err: any) {
      setError(err?.message ?? "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout title="Вход">
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-zinc-700">
          Вход по email и паролю. (Если регистрации нет — создайте пользователя в Supabase Dashboard, либо включите регистрацию отдельно.)
        </div>

        <form onSubmit={login} className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs text-zinc-600">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
              required
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-zinc-600">Пароль</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              className="w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
              required
            />
          </label>

          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          <button
            disabled={loading}
            type="submit"
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Входим…" : "Войти"}
          </button>
        </form>

        <div className="mt-4 text-xs text-zinc-600">
          <Link href="/" className="hover:text-zinc-900">
            ← На главную
          </Link>
        </div>
      </div>
    </Layout>
  );
}
