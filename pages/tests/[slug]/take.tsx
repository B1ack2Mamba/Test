import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { ForcedPairTestV1, Tag } from "@/lib/testTypes";
import { scoreForcedPair } from "@/lib/score";
import { useSession } from "@/lib/useSession";
import { saveAttempt } from "@/lib/localHistory";

function storageKey(slug: string) {
  return `attempt:${slug}:answers`;
}
function resultKey(slug: string) {
  return `attempt:${slug}:result`;
}
function authorKey(slug: string) {
  return `attempt:${slug}:author`;
}

const AUTHOR_PRICE_RUB = 99;

export default function TakeTest({ test }: { test: ForcedPairTestV1 }) {
  const router = useRouter();
  const { user, session } = useSession();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [answers, setAnswers] = useState<(Tag | null)[]>(() => {
    if (typeof window === "undefined") return Array(test.questions.length).fill(null);
    const raw = window.sessionStorage.getItem(storageKey(test.slug));
    if (!raw) return Array(test.questions.length).fill(null);
    try {
      const parsed = JSON.parse(raw) as (Tag | null)[];
      if (Array.isArray(parsed) && parsed.length === test.questions.length) return parsed;
      return Array(test.questions.length).fill(null);
    } catch {
      return Array(test.questions.length).fill(null);
    }
  });

  const answeredCount = useMemo(() => answers.filter(Boolean).length, [answers]);
  const canSubmit = answeredCount === test.questions.length;

  const pick = (idx: number, tag: Tag) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = tag;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(storageKey(test.slug), JSON.stringify(next));
      }
      return next;
    });
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");

    try {
      // 1) Считаем результат и сохраняем локально (чтобы попытка не терялась)
      const tags = answers.filter(Boolean) as Tag[];
      const res = scoreForcedPair(test, tags);

      if (typeof window !== "undefined") {
        // Важно: результат НЕ кладём в sessionStorage до оплаты,
        // иначе можно будет открыть /result бесплатно.
        window.sessionStorage.removeItem(resultKey(test.slug));
        window.sessionStorage.removeItem(authorKey(test.slug));

        // Локальная история (на устройстве пользователя)
        saveAttempt(user?.id || "guest", test.slug, res);
      }

      // 2) Для показа результата нужна оплата 99 ₽ (авторская расшифровка включена)
      if (!user || !session) {
        setError("Для показа результата нужно войти. После входа нажми «Показать результат» ещё раз.");
        router.push(`/auth?next=${encodeURIComponent(`/tests/${test.slug}/take`)}`);
        return;
      }

      if (!test.has_interpretation) {
        // Если у теста нет авторской расшифровки — показываем результат бесплатно
        // (редкий кейс, но пусть будет).
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(res));
          window.sessionStorage.removeItem(storageKey(test.slug));
        }
        router.push(`/tests/${test.slug}/result`);
        return;
      }

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
      if (!resp.ok || !json?.ok) {
        throw new Error(json?.error || "Ошибка оплаты авторской расшифровки");
      }

      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(res));
        window.sessionStorage.setItem(authorKey(test.slug), JSON.stringify(json.content ?? null));
        window.sessionStorage.removeItem(storageKey(test.slug));
      }

      router.push(`/tests/${test.slug}/result`);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title={test.title}>
      <div className="mb-4 rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-zinc-600">
            Прогресс: <span className="font-medium text-zinc-900">{answeredCount}/{test.questions.length}</span>
          </div>
          <Link href={`/tests/${test.slug}`} className="text-sm text-zinc-600 hover:text-zinc-900">
            ← к описанию
          </Link>
        </div>

        <div className="mt-3 h-2 w-full rounded-full bg-zinc-100">
          <div
            className="h-2 rounded-full bg-zinc-900 transition-all"
            style={{ width: `${Math.round((answeredCount / test.questions.length) * 100)}%` }}
          />
        </div>
      </div>

      <div className="grid gap-3">
        {test.questions.map((q, idx) => {
          const chosen = answers[idx];
          const [o1, o2] = q.options;
          return (
            <div key={q.order} className="rounded-2xl border bg-white p-4">
              <div className="mb-3 text-sm font-medium text-zinc-900">Пара {q.order}</div>
              <div className="grid gap-2 md:grid-cols-2">
                <button
                  onClick={() => pick(idx, o1.tag)}
                  className={[
                    "rounded-xl border p-3 text-left text-sm transition",
                    chosen === o1.tag ? "border-zinc-900 bg-zinc-50" : "hover:bg-zinc-50",
                  ].join(" ")}
                >
                  <div className="text-xs text-zinc-500">({o1.tag})</div>
                  <div className="mt-1">{o1.text}</div>
                </button>

                <button
                  onClick={() => pick(idx, o2.tag)}
                  className={[
                    "rounded-xl border p-3 text-left text-sm transition",
                    chosen === o2.tag ? "border-zinc-900 bg-zinc-50" : "hover:bg-zinc-50",
                  ].join(" ")}
                >
                  <div className="text-xs text-zinc-500">({o2.tag})</div>
                  <div className="mt-1">{o2.text}</div>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-zinc-600">
            Готово? Для результата нужно ответить на все пары.
            {test.has_interpretation ? (
              <>
                <span className="text-zinc-500"> </span>
                <span className="text-zinc-900">Показ результата списывает </span>
                <b className="text-zinc-900">{AUTHOR_PRICE_RUB} ₽</b>
                <span className="text-zinc-900"> и включает авторскую расшифровку.</span>
              </>
            ) : null}
          </div>

          <button
            disabled={!canSubmit || busy}
            onClick={submit}
            className={[
              "rounded-xl px-4 py-2 text-sm font-medium text-white",
              canSubmit && !busy ? "bg-zinc-900 hover:bg-zinc-800" : "cursor-not-allowed bg-zinc-300",
            ].join(" ")}
          >
            {busy ? "Обрабатываем…" : test.has_interpretation ? `Показать результат — ${AUTHOR_PRICE_RUB} ₽` : "Показать результат"}
          </button>
        </div>

        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

        <div className="mt-3 text-xs text-zinc-600">
          Нужно пополнить баланс? <Link href="/wallet" className="underline hover:text-zinc-900">Кошелёк</Link>
        </div>
      </div>
    </Layout>
  );
}

export async function getServerSideProps({ params }: { params: { slug: string } }) {
  const test = await getTestBySlug(params.slug);
  if (!test) return { notFound: true };
  return { props: { test } };
}
