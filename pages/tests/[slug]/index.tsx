import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { ForcedPairTestV1 } from "@/lib/testTypes";
import { useSession } from "@/lib/useSession";
import { formatLocalDate, loadAttempts, type LocalAttempt } from "@/lib/localHistory";

function resultKey(slug: string) {
  return `attempt:${slug}:result`;
}
function authorKey(slug: string) {
  return `attempt:${slug}:author`;
}

const AUTHOR_PRICE_RUB = 99;

export default function TestDetail({ test }: { test: ForcedPairTestV1 }) {
  const router = useRouter();
  const { user, session } = useSession();
  const [attempts, setAttempts] = useState<LocalAttempt[]>([]);
  const [openBusyId, setOpenBusyId] = useState<string>("");
  const [openError, setOpenError] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const list = loadAttempts(user?.id || "guest", test.slug);
    setAttempts(list);
  }, [user?.id, test.slug]);

  const openAttemptPaid = async (a: LocalAttempt) => {
    setOpenError("");

    // Открытие результата всегда платное (99 ₽) — даже для старых попыток из локальной истории
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
  };

  return (
    <Layout title={test.title}>
      {test.description ? <p className="mb-4 text-zinc-700">{test.description}</p> : null}

      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-zinc-600">Формат: выбрать 1 из 2 утверждений в каждой паре.</div>
        <div className="mt-2 text-sm text-zinc-600">Вопросов: {test.questions.length}</div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/tests/${test.slug}/take`}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Начать тест
          </Link>
          <Link
            href="/admin/import"
            className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Импорт другого теста
          </Link>
        </div>
      </div>

      {attempts.length ? (
        <div className="mt-4 rounded-2xl border bg-white p-4">
          <div className="text-sm font-medium">История (локально на этом устройстве)</div>
          <div className="mt-1 text-xs text-zinc-600">
            Важно: открытие результата списывает <b>{AUTHOR_PRICE_RUB} ₽</b> каждый раз.
          </div>

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
                    {busy ? "Открываем…" : `Открыть — ${AUTHOR_PRICE_RUB} ₽`}
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
