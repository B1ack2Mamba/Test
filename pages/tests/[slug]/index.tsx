import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { AnyTest } from "@/lib/testTypes";
import { useSession } from "@/lib/useSession";
import { formatLocalDate, loadAttempts, type LocalAttempt } from "@/lib/localHistory";

function resultKey(slug: string) {
  return `attempt:${slug}:result`;
}
function authorKey(slug: string) {
  return `attempt:${slug}:author`;
}

function priceRub(test: AnyTest) {
  return test.pricing?.interpretation_rub ?? 0;
}

function formatLabel(test: AnyTest) {
  if (test.type === "pair_sum5_v1") {
    return "Формат: распределять 5 баллов между двумя утверждениями в каждой паре.";
  }
  return "Формат: выбрать 1 из 2 утверждений в каждой паре.";
}

export default function TestDetail({ test }: { test: AnyTest }) {
  const router = useRouter();
  const { user, session } = useSession();

  const [attempts, setAttempts] = useState<LocalAttempt[]>([]);
  const [openBusyId, setOpenBusyId] = useState<string>("");
  const [openError, setOpenError] = useState<string>("");

  const p = useMemo(() => priceRub(test), [test]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const list = loadAttempts(user?.id || "guest", test.slug);
    setAttempts(list);
  }, [user?.id, test.slug]);

  const openAttemptPaid = async (a: LocalAttempt) => {
    setOpenError("");

    // Открытие результата всегда платное (если у теста выставлена цена)
    if (test.has_interpretation && p > 0) {
      if (!user || !session) {
        router.push(`/auth?next=${encodeURIComponent(`/tests/${test.slug}`)}`);
        return;
      }

      setOpenBusyId(a.id);
      try {
        const opId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
        const resp = await fetch("/api/purchases/author", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ test_slug: test.slug, op_id: opId }),
        });
        const json = await resp.json();
        if (!resp.ok || !json?.ok) throw new Error(json?.error || "Ошибка оплаты");

        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(a.result));
          window.sessionStorage.setItem(authorKey(test.slug), JSON.stringify(json.content ?? null));
        }

        router.push(`/tests/${test.slug}/result`);
      } catch (e: any) {
        setOpenError(e?.message ?? "Ошибка");
      } finally {
        setOpenBusyId("");
      }
      return;
    }

    // Бесплатные тесты (или без paywall)
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(a.result));
      window.sessionStorage.removeItem(authorKey(test.slug));
    }
    router.push(`/tests/${test.slug}/result`);
  };

  return (
    <Layout title={test.title}>
      {test.description ? <p className="mb-4 text-zinc-700">{test.description}</p> : null}

      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-zinc-600">{formatLabel(test)}</div>
        <div className="mt-2 text-sm text-zinc-600">Вопросов: {test.questions.length}</div>
        {test.has_interpretation && p > 0 ? (
          <div className="mt-2 text-sm text-zinc-600">
            Показ результата списывает <b className="text-zinc-900">{p} ₽</b>.
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/tests/${test.slug}/take`}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Начать тест
          </Link>
          <Link
            href="/"
            className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            На главную
          </Link>
        </div>
      </div>

      {attempts.length ? (
        <div className="mt-4 rounded-2xl border bg-white p-4">
          <div className="text-sm font-medium">История (локально на этом устройстве)</div>
          {test.has_interpretation && p > 0 ? (
            <div className="mt-1 text-xs text-zinc-600">
              Важно: открытие результата списывает <b>{p} ₽</b> каждый раз.
            </div>
          ) : (
            <div className="mt-1 text-xs text-zinc-600">Можно открывать результаты бесплатно.</div>
          )}

          {openError ? <div className="mt-3 text-sm text-red-600">{openError}</div> : null}

          <div className="mt-3 grid gap-2">
            {attempts.map((a) => {
              const top = a.result.ranked?.[0];
              const busy = openBusyId === a.id;
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
                    onClick={() => openAttemptPaid(a)}
                    disabled={busy}
                    className="rounded-xl border bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {busy ? "Открываем…" : test.has_interpretation && p > 0 ? `Открыть — ${p} ₽` : "Открыть"}
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

export async function getServerSideProps({ params }: { params: { slug: string } }) {
  const test = await getTestBySlug(params.slug);
  if (!test) return { notFound: true };
  return { props: { test } };
}
