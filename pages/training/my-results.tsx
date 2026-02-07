import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";
import type { AnyTest } from "@/lib/testTypes";

type Row = {
  attempt_id: string;
  test_slug: string;
  room_id: string;
  room_name: string | null;
  created_at: string;
  shared_at: string;
  has_interpretation: boolean;
  reveal_results: boolean;
};

function fmt(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

type Props = { tests: Pick<AnyTest, "slug" | "title">[] };

export default function MyTrainingResults({ tests }: Props) {
  const { session, user } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const titleBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tests || []) m.set(String(t.slug), String(t.title));
    return m;
  }, [tests]);

  const load = async () => {
    if (!session) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/training/self/shared-attempts", {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить");
      setRows(j.attempts || []);
    } catch (e: any) {
      setErr(e?.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!session) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  if (!session || !user) {
    return (
      <Layout title="Мои результаты">
        <div className="card text-sm text-zinc-700">
          Нужно войти.
          <div className="mt-3">
            <Link href="/auth?next=%2Ftraining%2Fmy-results" className="btn btn-secondary btn-sm">
              Вход / регистрация
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Мои результаты">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/training" className="text-sm font-medium text-zinc-900 underline">
          ← К тренингам
        </Link>
        <button
          onClick={load}
          disabled={loading}
          className="btn btn-secondary btn-sm"
        >
          {loading ? "…" : "Обновить"}
        </button>
      </div>

      {err ? <div className="mb-3 card text-sm text-red-600">{err}</div> : null}

      <div className="card text-sm text-zinc-700">
        Здесь отображаются результаты, которые специалист отправил вам в личный кабинет.
      </div>

      <div className="mt-3 grid gap-3">
        {rows.map((r) => (
          <div key={r.attempt_id} className="card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{titleBySlug.get(r.test_slug) || r.test_slug}</div>
                <div className="mt-1 text-xs text-zinc-500">Отправлено: {fmt(r.shared_at)}</div>
                <div className="mt-1 text-xs text-zinc-500">Комната: {r.room_name || r.room_id}</div>
              </div>
              <Link
                href={`/training/results?attempt=${encodeURIComponent(r.attempt_id)}`}
                className="btn btn-primary"
              >
                Открыть
              </Link>
            </div>

            <div className="mt-2 text-xs text-zinc-600">
              {r.reveal_results ? "✅ Результаты доступны" : r.has_interpretation ? "✅ Расшифровка готова" : "⏳ Ожидает расшифровки специалиста"}
            </div>
          </div>
        ))}

        {rows.length === 0 && !loading ? (
          <div className="card text-sm text-zinc-600">
            Пока нет отправленных результатов.
          </div>
        ) : null}
      </div>
    </Layout>
  );
}

export async function getServerSideProps() {
  const { getAllTests } = await import("@/lib/loadTests");
  const tests = await getAllTests();
  return { props: { tests: (tests || []).map((t) => ({ slug: t.slug, title: t.title })) } };
}
