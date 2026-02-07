import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";

type Mode = "login" | "signup";

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
  const [isSpecialist, setIsSpecialist] = useState(false);
  const [specialistCode, setSpecialistCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (user && session) {
      router.replace(next);
    }
  }, [user, session, next, router]);

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
        // Specialist sign-up uses server route (service_role) and a shared code.
        if (isSpecialist) {
          const r = await fetch("/api/auth/specialist-signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.trim(), password, code: specialistCode }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.ok) throw new Error(j.error || "Не удалось создать специалиста");
          setInfo("Аккаунт специалиста создан. Теперь войдите по email и паролю.");
          setMode("login");
          return;
        }

        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        setInfo(
          "Аккаунт создан. Если в Supabase включено подтверждение email — потребуется подтвердить почту. Если подтверждение выключено — можно сразу входить."
        );
        setMode("login");
        return;
      }
    } catch (err: any) {
      setError(err?.message ?? "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout title="Вход">
      <div className="card">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`btn btn-sm ${mode === "login" ? "btn-primary" : "btn-secondary"}`}
          >
            Вход
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`btn btn-sm ${mode === "signup" ? "btn-primary" : "btn-secondary"}`}
          >
            Регистрация
          </button>
        </div>

        <div className="mt-3 text-xs text-slate-600">
          {mode === "login" ? "Вход по email и паролю." : null}
          {mode === "signup"
            ? "Создайте аккаунт по email и паролю. Если вы специалист — включите переключатель и введите общий код."
            : null}
        </div>

        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs text-slate-600">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              className="input"
              required
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-slate-600">Пароль</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              className="input"
              required
            />
          </label>

          {mode === "signup" ? (
            <div className="card-soft p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isSpecialist}
                  onChange={(e) => setIsSpecialist(e.target.checked)}
                />
                Я специалист
              </label>

              {isSpecialist ? (
                <label className="mt-2 grid gap-1">
                  <span className="text-xs text-slate-600">Код специалиста</span>
                  <input
                    value={specialistCode}
                    onChange={(e) => setSpecialistCode(e.target.value)}
                    type="password"
                    placeholder="SPECIALIST_SIGNUP_CODE"
                    className="input"
                    required
                  />
                  <div className="text-[11px] text-slate-500">
                    Код общий для всех специалистов. Хранится в ENV как <b>SPECIALIST_SIGNUP_CODE</b>.
                  </div>
                </label>
              ) : (
                <div className="mt-2 text-[11px] text-slate-500">
                  Если вы участник тренинга — просто регистрируйтесь как обычный пользователь.
                </div>
              )}
            </div>
          ) : null}

          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {info ? <div className="text-sm text-slate-700">{info}</div> : null}

          <button
            disabled={loading}
            type="submit"
            className="btn btn-primary w-full"
          >
            {loading
              ? "..."
              : mode === "login"
              ? "Войти"
              : mode === "signup"
              ? "Зарегистрироваться"
              : "Продолжить"}
          </button>
        </form>

        <div className="mt-4 text-xs text-slate-600">
          <Link href="/" className="link">
            ← На главную
          </Link>
        </div>
      </div>
    </Layout>
  );
}
