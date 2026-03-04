import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";

export default function TrainingDone() {
  const router = useRouter();
  const { session } = useSession();

  const roomId = String(router.query.roomId || "");
  const slug = String(router.query.slug || "");

  const [nextSlug, setNextSlug] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<"idle" | "loading" | "ready" | "none" | "error">("idle");
  const [nextErr, setNextErr] = useState<string>("");
  const [nextBusy, setNextBusy] = useState(false);

  const canComputeNext = useMemo(
    () => !!session?.access_token && !!roomId && !!slug,
    [session?.access_token, roomId, slug]
  );

  useEffect(() => {
    if (!canComputeNext) return;
    let cancelled = false;

    const run = async () => {
      setNextErr("");
      setNextSlug(null);
      setNextStatus("loading");
      try {
        const headers = { authorization: `Bearer ${session!.access_token}` };

        const [testsRes, progRes] = await Promise.all([
          fetch(`/api/training/rooms/tests/get?room_id=${encodeURIComponent(roomId)}`, { headers }),
          fetch(`/api/training/progress/my?room_id=${encodeURIComponent(roomId)}`, { headers }),
        ]);

        const testsJson: any = await testsRes.json().catch(() => ({}));
        const progJson: any = await progRes.json().catch(() => ({}));

        if (!testsRes.ok || !testsJson?.ok) throw new Error(testsJson?.error || "Не удалось загрузить список тестов");
        if (!progRes.ok || !progJson?.ok) throw new Error(progJson?.error || "Не удалось загрузить прогресс");

        const roomTests = Array.isArray(testsJson.room_tests) ? testsJson.room_tests : [];
        const ordered = [...roomTests]
          .filter((r: any) => !!r && (r.is_enabled === undefined ? true : !!r.is_enabled))
          .sort((a: any, b: any) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
          .map((r: any) => String(r.test_slug));

        const progress = Array.isArray(progJson.progress) ? progJson.progress : [];
        const completed = new Set(
          progress
            .filter((p: any) => !!p && !!p.completed_at)
            .map((p: any) => String(p.test_slug))
        );

        let found: string | null = null;
        if (ordered.length) {
          const startIdx = Math.max(0, ordered.indexOf(slug));

          // Next uncompleted after current (wrap-around).
          for (let step = 1; step <= ordered.length; step++) {
            const idx = (startIdx + step) % ordered.length;
            const s = ordered[idx];
            if (!completed.has(s)) {
              found = s;
              break;
            }
          }
        }

        if (cancelled) return;
        setNextSlug(found);
        setNextStatus(found ? "ready" : "none");
      } catch (e: any) {
        if (cancelled) return;
        setNextErr(e?.message || "Ошибка");
        setNextStatus("error");
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [canComputeNext, roomId, slug, session]);

  const goNext = async () => {
    if (!nextSlug || !roomId) return;
    setNextBusy(true);
    try {
      await router.push(
        `/training/rooms/${encodeURIComponent(roomId)}/tests/${encodeURIComponent(nextSlug)}/take`
      );
    } finally {
      setNextBusy(false);
    }
  };

  const nextLabel =
    nextBusy ? "Переходим…" :
    nextStatus === "loading" ? "Следующий тест…" :
    nextStatus === "none" ? "Все тесты пройдены" :
    "Следующий тест";

  return (
    <Layout title="Тест завершён">
      <div className="card">
        <div className="text-lg font-semibold">Готово ✅</div>
        <div className="mt-1 text-sm text-zinc-700">Результаты отправлены специалисту в комнате.</div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/training/rooms/${encodeURIComponent(roomId)}`} className="btn btn-primary">
            Назад в комнату
          </Link>

          {canComputeNext ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={goNext}
              disabled={nextBusy || nextStatus !== "ready"}
              title={nextStatus === "none" ? "Все тесты в комнате уже пройдены" : undefined}
            >
              {nextLabel}
            </button>
          ) : null}
        </div>

        {nextErr ? <div className="mt-3 text-sm text-red-600">{nextErr}</div> : null}
      </div>
    </Layout>
  );
}
