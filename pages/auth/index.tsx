import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";

type Mode = "login" | "signup";
type AuthKind = "name" | "email";

export default function AuthPage() {
  const { supabase, user, session } = useSession();
  const router = useRouter();
  const next = useMemo(() => {
    const n = router.query.next;
    return typeof n === "string" ? n : "/training";
  }, [router.query.next]);

  const [mode, setMode] = useState<Mode>("signup");
  const [authKind, setAuthKind] = useState<AuthKind>("name");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [password2Touched, setPassword2Touched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);
  const [isSpecialist, setIsSpecialist] = useState(false);
  const [specialistCode, setSpecialistCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const passwordTooShort = useMemo(() => mode === "signup" && password.length > 0 && password.length < 8, [mode, password]);
  const passwordMismatch = useMemo(
    () => mode === "signup" && password2Touched && password2.length > 0 && password !== password2,
    [mode, password, password2, password2Touched]
  );

  useEffect(() => {
    if (user && session) {
      router.replace(next);
    }
  }, [user, session, next, router]);

  useEffect(() => {
    if (authKind !== "email" || mode !== "signup") {
      setIsSpecialist(false);
      setSpecialistCode("");
    }
  }, [authKind, mode]);


  const humanizeAuthError = (message: string) => {
    if (/Server env missing:/i.test(message)) {
      return "На сервере не настроены переменные Supabase. Добавьте NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (или NEXT_PUBLIC_SUPABASE_ANON_KEY) и SUPABASE_SERVICE_ROLE_KEY в ENV проекта.";
    }
    return message;
  };

  const applyServerSession = async (payload: any) => {
    if (!supabase) throw new Error("Supabase client is not ready");
    const accessToken = String(payload?.session?.access_token || "");
    const refreshToken = String(payload?.session?.refresh_token || "");
    if (!accessToken || !refreshToken) throw new Error("Сервер не вернул сессию");
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    setError("");
    setInfo("");

    try {
      if (mode === "login") {
        if (authKind === "email") {
          const { error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (error) throw error;
          return;
        }

        const r = await fetch("/api/auth/name-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ first_name: firstName, last_name: lastName, password }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "Не удалось войти");
        await applyServerSession(j);
        return;
      }

      if (password.length < 8) throw new Error("Пароль должен быть не короче 8 символов.");
      if (password !== password2) throw new Error("Пароли не совпадают.");

      if (authKind === "name") {
        const r = await fetch("/api/auth/name-signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ first_name: firstName, last_name: lastName, password }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "Не удалось создать аккаунт");
        if (j?.session?.access_token && j?.session?.refresh_token) {
          await applyServerSession(j);
          return;
        }
        setInfo(String(j?.message || "Аккаунт создан. Теперь войдите по имени, фамилии и паролю."));
        setMode("login");
        return;
      }

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
        setAuthKind("email");
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
      setAuthKind("email");
      return;
    } catch (err: any) {
      setError(humanizeAuthError(err?.message ?? "Ошибка"));
    } finally {
      setLoading(false);
    }
  };

  const nameAuthActive = authKind === "name";
  const showRepeatPassword = mode === "signup";

  return (
    <Layout title={mode === "signup" ? "Регистрация" : "Вход"}>
      <div className="card">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`btn btn-sm ${mode === "signup" ? "btn-primary" : "btn-secondary"}`}
          >
            Регистрация
          </button>
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`btn btn-sm ${mode === "login" ? "btn-primary" : "btn-secondary"}`}
          >
            Вход
          </button>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setAuthKind("name")}
            className={`rounded-2xl border px-4 py-3 text-left transition ${nameAuthActive ? "border-indigo-300 bg-indigo-50 text-indigo-950" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"}`}
          >
            <div className="text-sm font-semibold">🪪 По имени и фамилии</div>
            <div className="mt-1 text-xs text-zinc-500">
              {mode === "signup" ? "Основная регистрация без почты." : "Вход по имени, фамилии и паролю."}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setAuthKind("email")}
            className={`rounded-2xl border px-4 py-3 text-left transition ${!nameAuthActive ? "border-indigo-300 bg-indigo-50 text-indigo-950" : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"}`}
          >
            <div className="text-sm font-semibold">✉️ По почте</div>
            <div className="mt-1 text-xs text-zinc-500">
              {mode === "signup" ? "Альтернативная регистрация по email." : "Обычный вход по email и паролю."}
            </div>
          </button>
        </div>

        <div className="mt-3 text-xs text-slate-600">
          {mode === "signup" && authKind === "name" ? null : null}
          {mode === "signup" && authKind === "email" ? "Регистрация по email и паролю. Для специалистов используйте этот режим." : null}
          {mode === "login" && authKind === "name" ? "Вход по имени, фамилии и паролю." : null}
          {mode === "login" && authKind === "email" ? "Вход по email и паролю." : null}
        </div>

        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
          {authKind === "name" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs text-slate-600">Имя</span>
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Алекс"
                    className="input"
                    required
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-slate-600">Фамилия</span>
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Иванов"
                    className="input"
                    required
                  />
                </label>
              </div>
            </>
          ) : (
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
          )}

          <label className="grid gap-1">
            <span className="text-xs text-slate-600">Пароль</span>
            <div className="relative">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                className="input pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>
            {mode === "signup" ? <div className="text-[11px] text-slate-500">8+ символов</div> : null}
            {passwordTooShort ? <div className="text-sm text-red-600">Пароль должен быть не короче 8 символов.</div> : null}
          </label>

          {showRepeatPassword ? (
            <label className="grid gap-1">
              <span className="text-xs text-slate-600">Повторите пароль</span>
              <div className="relative">
                <input
                  value={password2}
                  onChange={(e) => {
                    setPassword2(e.target.value);
                    if (!password2Touched) setPassword2Touched(true);
                  }}
                  type={showPassword2 ? "text" : "password"}
                  placeholder="••••••••"
                  className="input pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword2((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                  aria-label={showPassword2 ? "Скрыть пароль" : "Показать пароль"}
                >
                  {showPassword2 ? "🙈" : "👁"}
                </button>
              </div>
              {passwordMismatch ? <div className="text-sm text-red-600">Пароли не совпадают.</div> : null}
            </label>
          ) : null}

          {mode === "signup" && authKind === "email" ? (
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
                  Участникам тренинга обычно достаточно регистрации по имени и фамилии. Почта — запасной путь.
                </div>
              )}
            </div>
          ) : null}

          {mode === "signup" && authKind === "name" ? (
            <div className="rounded-2xl border border-zinc-200 bg-white/60 px-3 py-2 text-[11px] text-zinc-600">
              Для участников тренинга имя и фамилия становятся основным способом входа. Если у двух людей совпадают имя и фамилия, одному из них лучше использовать регистрацию по почте.
            </div>
          ) : null}

          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {info ? <div className="text-sm text-slate-700">{info}</div> : null}

          <button disabled={loading} type="submit" className="btn btn-primary w-full">
            {loading ? "..." : mode === "signup" ? "Продолжить" : "Войти"}
          </button>
        </form>

        <div className="mt-4 text-xs text-slate-600">
          <Link href="/training" className="link">
            ← К комнатам
          </Link>
        </div>
      </div>
    </Layout>
  );
}
