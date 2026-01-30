import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { AnyTest } from "@/lib/testTypes";
import { useSession } from "@/lib/useSession";
import { formatLocalDate, getAttempt, loadAttempts, updateAttempt, type LocalAttempt } from "@/lib/localHistory";

function resultKey(slug: string) {
  return `attempt:${slug}:result`;
}
function authorKey(slug: string) {
  return `attempt:${slug}:author`;
}
function attemptIdKey(slug: string) {
  return `attempt:${slug}:id`;
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
    const userId = user?.id || "guest";
    const refresh = () => setAttempts(loadAttempts(userId, test.slug));
    refresh();

    // На back/forward (bfcache) или при возврате на вкладку состояние может быть старым.
    // Поэтому всегда обновляем историю при фокусе/видимости.
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

  const openAttemptPaid = async (a: LocalAttempt) => {
    setOpenError("");

    const userId = user?.id || "guest";
    // Берём самую свежую версию попытки из localStorage (на случай устаревшего state)
    const latest = getAttempt(userId, test.slug, a.id) ?? a;

    // Платные тесты: первый показ конкретной попытки — платный.
    // Повторный просмотр этой же попытки — бесплатный (локальный кэш).
    if (test.has_interpretation && p > 0) {
      // Уже оплачено для этой попытки — открываем без списания
      if (latest.paid_author?.at) {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(latest.result));
          window.sessionStorage.setItem(authorKey(test.slug), JSON.stringify(latest.paid_author?.content ?? null));
          window.sessionStorage.setItem(attemptIdKey(test.slug), latest.id);
        }
        router.push(`/tests/${test.slug}/result`);
        return;
      }

      // Не оплачено: для списания нужен логин
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

        // Кэшируем оплату для конкретной попытки (повторный просмотр бесплатный)
        updateAttempt(user.id, test.slug, latest.id, { paid_author: { at: Date.now(), content: json.content ?? null } });

        // Обновляем список в состоянии, чтобы кнопка сразу стала "оплачено"
        setAttempts(loadAttempts(user.id, test.slug));

        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(latest.result));
          window.sessionStorage.setItem(authorKey(test.slug), JSON.stringify(json.content ?? null));
          window.sessionStorage.setItem(attemptIdKey(test.slug), latest.id);
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
      window.sessionStorage.setItem(attemptIdKey(test.slug), a.id);
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
            Первый показ результата этой попытки списывает <b className="text-zinc-900">{p} ₽</b>. Повторный просмотр — бесплатный.
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
              Важно: списание <b>{p} ₽</b> происходит только при первом открытии <b>конкретной попытки</b>. Повторный просмотр этой же попытки бесплатный.
            </div>
          ) : (
            <div className="mt-1 text-xs text-zinc-600">Можно открывать результаты бесплатно.</div>
          )}

          {openError ? <div className="mt-3 text-sm text-red-600">{openError}</div> : null}

          <div className="mt-3 grid gap-2">
            {attempts.map((a) => {
              const top = a.result.ranked?.[0];
              const busy = openBusyId === a.id;
              const paid = !!a.paid_author?.at;
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2">
                  <div>
                    <div className="text-xs text-zinc-600">{formatLocalDate(a.created_at)}</div>
                    {top ? (
                      <div className="text-sm">
                        {(() => {
                          const kind = a.result.kind;
                          let denom: number | null = null;
                          if (kind === "forced_pair_v1" || kind === "color_types_v1" || kind === "usk_v1") denom = a.result.total;
                          if (kind === "pair_sum5_v1") {
                            const m = (a.result as any).meta?.maxByFactor;
                            const d = m?.[top.tag];
                            denom = Number.isFinite(d) ? Number(d) : null;
                          }
                          const extra = denom ? ` (${top.count}/${denom})` : ` (${top.count})`;
                          return (
                            <>
                              Топ: <b>{top.style}</b> ({top.percent}%<span className="text-xs text-zinc-600">{extra}</span>)
                            </>
                          );
                        })()}
                      </div>
                    ) : null}
                  </div>
                  <button
                    onClick={() => openAttemptPaid(a)}
                    disabled={busy}
                    className="rounded-xl border bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {busy
                      ? "Открываем…"
                      : test.has_interpretation && p > 0
                      ? paid
                        ? "Открыть"
                        : `Открыть — ${p} ₽`
                      : "Открыть"}
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
