import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";

export default function TrainingResults() {
  const router = useRouter();
  const { session, user, loading: sessionLoading } = useSession();
  const attemptId = String((router.query.attempt || router.query.attempt_id || "") as string);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [meta, setMeta] = useState<any>(null);

  useEffect(() => {
    if (!router.isReady) return;
    if (!attemptId) return;
    if (sessionLoading) return;
    if (!session) {
      router.replace(`/auth?next=${encodeURIComponent(router.asPath)}`);
      return;
    }
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch(`/api/training/self/interpretation?attempt_id=${encodeURIComponent(attemptId)}`, {
          headers: { authorization: `Bearer ${session.access_token}` },
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить");
        setText(String(j.text || ""));
        setMeta(j.attempt || null);
      } catch (e: any) {
        setErr(e?.message || "Ошибка");
      } finally {
        setLoading(false);
      }
    })();
  }, [router.isReady, attemptId, session, sessionLoading, router.asPath]);

  return (
    <Layout title="Результаты">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/training" className="text-sm font-medium text-zinc-900 underline">
          ← К тренингам
        </Link>
      </div>

      {!attemptId ? (
        <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-700">Нет attempt_id.</div>
      ) : null}

      {err ? <div className="mb-3 rounded-2xl border bg-white p-4 text-sm text-red-600">{err}</div> : null}

      {attemptId ? (
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm font-semibold">Ваша расшифровка</div>
          {meta ? <div className="mt-1 text-xs text-zinc-500">test: {meta.test_slug}</div> : null}

          <div className="mt-3 rounded-2xl border bg-white p-3 text-sm whitespace-pre-wrap">
            {loading ? (
              <div className="text-zinc-500">Загрузка…</div>
            ) : text ? (
              text
            ) : (
              <div className="text-zinc-500">
                Пока нет расшифровки. Она появится после того, как специалист подготовит текст и нажмёт «Отправить».
              </div>
            )}
          </div>
        </div>
      ) : null}

      {!user ? <div className="mt-4 text-xs text-zinc-500">Нужен вход.</div> : null}
    </Layout>
  );
}
