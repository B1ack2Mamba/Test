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
        if (password.length < 8) throw new Error("Пароль должен быть не короче 8 символов.");
        if (password !== password2) throw new Error("Пароли не совпадают.");

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
            {passwordTooShort ? (
              <div className="text-sm text-red-600">Пароль должен быть не короче 8 символов.</div>
            ) : null}
          </label>

          {mode === "signup" ? (
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
          <Link href="/training" className="link">
            ← К комнатам
          </Link>
        </div>
      </div>
    </Layout>
  );
}
