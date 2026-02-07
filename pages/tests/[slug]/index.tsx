import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import type { AnyTest } from "@/lib/testTypes";
import { useSession } from "@/lib/useSession";
import { formatLocalDate, getAttempt, loadAttempts, type LocalAttempt } from "@/lib/localHistory";

function resultKey(slug: string) {
  return `attempt:${slug}:result`;
}
function authorKey(slug: string) {
  return `attempt:${slug}:author`;
}
function attemptIdKey(slug: string) {
  return `attempt:${slug}:id`;
}

export default function TestDetail({ test }: { test: AnyTest }) {
  const router = useRouter();
  const { user } = useSession();

  const [attempts, setAttempts] = useState<LocalAttempt[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const userId = user?.id || "guest";
    const refresh = () => setAttempts(loadAttempts(userId, test.slug));
    refresh();

    const onFocus = () => refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [user?.id, test.slug]);

  const openAttempt = (a: LocalAttempt) => {
    const userId = user?.id || "guest";
    const latest = getAttempt(userId, test.slug, a.id) ?? a;

    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(latest.result));
      if (latest.paid_author?.content) {
        window.sessionStorage.setItem(authorKey(test.slug), JSON.stringify(latest.paid_author.content));
      } else {
        window.sessionStorage.removeItem(authorKey(test.slug));
      }
      window.sessionStorage.setItem(attemptIdKey(test.slug), latest.id);
    }

    router.push(`/tests/${test.slug}/result`);
  };

  return (
    <Layout title={test.title}>
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-zinc-600">Вопросов: {test.questions.length}</div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/tests/${test.slug}/take`}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Начать тест
          </Link>
          <Link href="/" className="rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50">
            На главную
          </Link>
        </div>
      </div>

      {attempts.length ? (
        <div className="mt-4 rounded-2xl border bg-white p-4">
          <div className="text-sm font-medium">История</div>
          <div className="mt-3 grid gap-2">
            {attempts.map((a) => {
              const top = a.result.ranked?.[0];
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2">
                  <div>
                    <div className="text-xs text-zinc-600">{formatLocalDate(a.created_at)}</div>
                    {top ? (
                      <div className="text-sm">
                        Топ: <b>{top.style}</b> ({top.percent}%)
                      </div>
                    ) : null}
                  </div>
                  <button
                    onClick={() => openAttempt(a)}
                    className="rounded-xl border bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                  >
                    Открыть
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
