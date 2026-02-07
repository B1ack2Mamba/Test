import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getSupabaseBrowser } from "@/lib/supabaseBrowser";

export default function AuthCallbackPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowser(), []);
  const [msg, setMsg] = useState("⏳ Завершаю вход...");

  useEffect(() => {
    if (!router.isReady) return;
    const code = typeof router.query.code === "string" ? router.query.code : null;
    const next = typeof router.query.next === "string" ? router.query.next : "/";

    if (!supabase) {
      setMsg("Supabase не настроен (.env.local)");
      return;
    }

    if (!code) {
      setMsg("В ссылке нет code. Попробуй запросить вход заново.");
      return;
    }

    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) {
          setMsg(`❌ ${error.message}`);
          return;
        }
        router.replace(next);
      })
      .catch((e: any) => setMsg(`❌ ${e?.message ?? "Ошибка"}`));
  }, [router.isReady, router.query.code, router.query.next, router, supabase]);

  return (
    <Layout title="Вход">
      <div className="card text-sm text-zinc-700">{msg}</div>
    </Layout>
  );
}
