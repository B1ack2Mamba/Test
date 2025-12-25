import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { getSupabaseBrowser } from "@/lib/supabaseBrowser";

export default function AuthPage() {
    const router = useRouter();
    const supabase = useMemo(() => getSupabaseBrowser(), []);

    const [mode, setMode] = useState<"signin" | "signup">("signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        if (!supabase) return;
        supabase.auth.getSession().then((res) => {
            if (res.data.session) router.replace("/");
        });
    }, [supabase, router]);

    async function onSubmit(e: FormEvent) {
        e.preventDefault();
        setMsg(null);

        if (!supabase) {
            setMsg("Supabase не настроен");
            return;
        }

        const cleanEmail = email.trim().toLowerCase();
        if (!cleanEmail) return setMsg("Введите email");
        if (password.length < 6) return setMsg("Пароль минимум 6 символов");

        setLoading(true);
        try {
            if (mode === "signup") {
                const { data, error } = await supabase.auth.signUp({
                    email: cleanEmail,
                    password,
                });
                if (error) throw error;

                // Если в Supabase включено Confirm sign up, сессии может не быть.
                if (!data.session) {
                    setMsg(
                        "Аккаунт создан, но вход не завершён. В Supabase выключи Confirm sign up, чтобы вход работал без писем."
                    );
                    return;
                }

                router.replace("/");
                return;
            }

            const { error } = await supabase.auth.signInWithPassword({
                email: cleanEmail,
                password,
            });
            if (error) throw error;

            router.replace("/");
        } catch (err: unknown) {
            const text = err instanceof Error ? err.message : "Ошибка входа";
            setMsg(`❌ ${text}`);
        } finally {
            setLoading(false);
        }
    }

    return (
        <Layout title={mode === "signin" ? "Вход" : "Регистрация"}>
            <div className="rounded-2xl border bg-white p-4">
                <form onSubmit={onSubmit} className="flex flex-col gap-3">
                    <label className="text-sm font-medium text-zinc-700">Email</label>
                    <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
                        placeholder="you@example.com"
                        autoComplete="email"
                    />

                    <label className="text-sm font-medium text-zinc-700">Пароль</label>
                    <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
                        placeholder="минимум 6 символов"
                        type="password"
                        autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    />

                    {msg ? <div className="text-sm text-zinc-700">{msg}</div> : null}

                    <button
                        disabled={loading}
                        type="submit"
                        className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                    >
                        {loading ? "..." : mode === "signin" ? "Войти" : "Создать аккаунт"}
                    </button>

                    <div className="flex items-center justify-between text-xs text-zinc-500">
                        <Link href="/" className="hover:text-zinc-900">
                            На главную
                        </Link>

                        {mode === "signin" ? (
                            <button
                                type="button"
                                onClick={() => setMode("signup")}
                                className="underline hover:text-zinc-900"
                            >
                                Регистрация
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setMode("signin")}
                                className="underline hover:text-zinc-900"
                            >
                                Уже есть аккаунт
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </Layout>
    );
}
