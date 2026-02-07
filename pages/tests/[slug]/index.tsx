import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import type { AnyTest } from "@/lib/testTypes";
import { getTestBySlug } from "@/lib/loadTests";
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

export default function TestDetail({ test }: { test: AnyTest | null }) {
  const router = useRouter();
  const { user } = useSession();

  // Safety guard: should never happen (SSR provides test), but prevents build/runtime crashes.
  if (!test) {
    return (
      <Layout title="Тест не найден">
        <div className="card">
          <div className="text-sm font-medium">Тест не найден</div>
          <div className="mt-3">
            <Link href="/" className="btn btn-secondary">
              На главную
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

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
    <Layout title={test?.title ?? "Тест"}>
      <div className="card">
        {!test ? (
          <div className="text-sm text-zinc-900">Тест не найден</div>
        ) : (
          <div className="text-sm text-zinc-600">Вопросов: {test.questions.length}</div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {test ? (
            <Link
              href={`/tests/${test.slug}/take`}
              className="btn btn-primary"
            >
              Начать тест
            </Link>
          ) : null}
          <Link href="/" className="btn btn-secondary">
            На главную
          </Link>
        </div>
      </div>

      {attempts.length ? (
        <div className="mt-4 card">
          <div className="text-sm font-medium">История</div>
          <div className="mt-3 grid gap-2">
            {attempts.map((a) => {
              const top = a.result.ranked
                ? [...a.result.ranked].sort((x, y) => (y?.percent ?? 0) - (x?.percent ?? 0))[0]
                : null;
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/60 bg-white/50 px-3 py-2 backdrop-blur-sm">
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
                    className="btn btn-secondary"
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

export async function getServerSideProps({ params }: { params: { slug?: string } }) {
  const slug = params?.slug;
  if (!slug || typeof slug !== "string") return { notFound: true };
  const test = await getTestBySlug(slug);
  if (!test) return { notFound: true };
  return { props: { test } };
}
