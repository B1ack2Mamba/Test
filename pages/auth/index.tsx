import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getSupabaseBrowser } from "@/lib/supabaseBrowser";

export default function AuthPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [email, setEmail] = useState(""
  );
  const [status, setStatus] = useState<string>("");

  return (
    <Layout title="Вход">
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-zinc-700">
          Вход по email (magic-link). Ссылка придёт на почту.
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
          />
          <button
            onClick={async () => {
              if (!supabase) {
                setStatus("Supabase не настроен (.env.local)");
                return;
              }
              const e = email.trim();
              if (!e) {
                setStatus("Введите email");
                return;
              }
              setStatus("⏳ Отправляю ссылку...");
              const next = typeof router.query.next === "string" ? router.query.next : "/";
              const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
              const { error } = await supabase.auth.signInWithOtp({
                email: e,
                options: { emailRedirectTo: redirectTo },
              });
              if (error) {
                setStatus(`❌ ${error.message}`);
              } else {
                setStatus("✅ Проверь почту и перейди по ссылке");
              }
            }}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Получить ссылку
          </button>
        </div>

        {status ? <div className="mt-3 text-sm text-zinc-700">{status}</div> : null}

        <div className="mt-4 text-xs text-zinc-500">
          После входа вернёшься обратно: {String(router.query.next ?? "/")}.
        </div>
      </div>
    </Layout>
  );
}
