import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";

type Mode = "login" | "signup" | "otp";

export default function AuthPage() {
  const { supabase, user, session } = useSession();
  const router = useRouter();
  const next = useMemo(() => {
    const n = router.query.next;
    return typeof n === "string" ? n : "/";
  }, [router.query.next]);

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (user && session) {
      router.replace(next);
    }
  }, [user, session, next, router]);

  const emailRedirectTo = useMemo(() => {
    // Works both locally and on Vercel.
    if (typeof window === "undefined") return undefined;
    const base = window.location.origin;
    return `${base}/auth/callback?next=${encodeURIComponent(next)}`;
  }, [next]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError("");
    setInfo("");

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        return;
      }

      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: emailRedirectTo ? { emailRedirectTo } : undefined,
        });
        if (error) throw error;
        setInfo(
          "Регистрация отправлена. Если подтверждение email включено в Supabase — проверь почту. Если подтверждение выключено — можно сразу входить."
        );
        setMode("login");
        return;
      }

      // OTP / magic link
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: emailRedirectTo ? { emailRedirectTo } : undefined,
      });
      if (error) throw error;
      setInfo("Ссылка для входа отправлена на почту (если почтовый провайдер настроен в Supabase). ");
    } catch (err: any) {
      setError(err?.message ?? "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout title="Вход">
      <div className="rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`rounded-xl px-3 py-1.5 text-sm ${
              mode === "login" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
            }`}
          >
            Вход
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded-xl px-3 py-1.5 text-sm ${
              mode === "signup" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
            }`}
          >
            Регистрация
          </button>
          <button
            type="button"
            onClick={() => setMode("otp")}
            className={`rounded-xl px-3 py-1.5 text-sm ${
              mode === "otp" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
            }`}
          >
            Ссылка на почту
          </button>
        </div>

        <div className="mt-3 text-xs text-zinc-600">
          {mode === "login" ? "Вход по email и паролю." : null}
          {mode === "signup" ? "Создайте аккаунт по email и паролю." : null}
          {mode === "otp" ? "Вход по ссылке (magic link). Требует настроенный SMTP в Supabase." : null}
        </div>

        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
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

          {mode !== "otp" ? (
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
          ) : null}

          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {info ? <div className="text-sm text-zinc-700">{info}</div> : null}

          <button
            disabled={loading}
            type="submit"
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading
              ? "..."
              : mode === "login"
              ? "Войти"
              : mode === "signup"
              ? "Зарегистрироваться"
              : "Отправить ссылку"}
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
