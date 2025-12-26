import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { AnyTest, ForcedPairTestV1, PairSplitTestV1, Tag } from "@/lib/testTypes";
import { scoreForcedPair, scorePairSplit } from "@/lib/score";
import { useSession } from "@/lib/useSession";
import { saveAttempt, updateAttempt } from "@/lib/localHistory";

function storageKey(slug: string) {
  return `attempt:${slug}:draft`;
}
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

function buttonLabel(test: AnyTest) {
  const p = priceRub(test);
  if (test.has_interpretation && p > 0) return `Показать результат — ${p} ₽`;
  return "Показать результат";
}

function ensureProgress(total: number, answered: number) {
  if (total <= 0) return 0;
  return Math.round((answered / total) * 100);
}

function setSessionDraft(slug: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(storageKey(slug), JSON.stringify(value));
}

function getSessionDraft<T>(slug: string): T | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(storageKey(slug));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function clearSession(slug: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(storageKey(slug));
  window.sessionStorage.removeItem(resultKey(slug));
  window.sessionStorage.removeItem(authorKey(slug));
  window.sessionStorage.removeItem(attemptIdKey(slug));
}

async function buyAndAttachAuthor({
  test,
  accessToken,
}: {
  test: AnyTest;
  accessToken: string;
}): Promise<any> {
  const opId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  const resp = await fetch("/api/purchases/author", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ test_slug: test.slug, op_id: opId }),
  });
  const json = await resp.json();
  if (!resp.ok || !json?.ok) {
    throw new Error(json?.error || "Ошибка оплаты авторской расшифровки");
  }
  return json.content ?? null;
}

function ForcedPairForm({ test }: { test: ForcedPairTestV1 }) {
  const router = useRouter();
  const { user, session } = useSession();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [answers, setAnswers] = useState<(Tag | null)[]>(() => {
    const draft = getSessionDraft<(Tag | null)[]>(test.slug);
    if (draft && Array.isArray(draft) && draft.length === test.questions.length) return draft;
    return Array(test.questions.length).fill(null);
  });

  const answeredCount = useMemo(() => answers.filter(Boolean).length, [answers]);
  const canSubmit = answeredCount === test.questions.length;

  const pick = (idx: number, tag: Tag) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = tag;
      setSessionDraft(test.slug, next);
      return next;
    });
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");

    try {
      // 1) считаем результат и сохраняем в локальной истории
      const tags = answers.filter(Boolean) as Tag[];
      const res = scoreForcedPair(test, tags);

      const userId = user?.id || "guest";
      const attempt = typeof window !== "undefined" ? saveAttempt(userId, test.slug, res) : null;

      if (typeof window !== "undefined") {
        // До оплаты не кладём result/author
        window.sessionStorage.removeItem(resultKey(test.slug));
        window.sessionStorage.removeItem(authorKey(test.slug));
        if (attempt?.id) window.sessionStorage.setItem(attemptIdKey(test.slug), attempt.id);
      }

      // 2) если тест платный — нужна сессия
      if (test.has_interpretation && priceRub(test) > 0) {
        if (!user || !session) {
          setError("Для показа результата нужно войти. После входа нажми «Показать результат» ещё раз.");
          router.push(`/auth?next=${encodeURIComponent(`/tests/${test.slug}/take`)}`);
          return;
        }

        const author = await buyAndAttachAuthor({ test, accessToken: session.access_token });

        // 2.1) помечаем конкретную попытку как уже оплаченную (повторный просмотр бесплатный)
        if (attempt?.id) {
          updateAttempt(userId, test.slug, attempt.id, {
            paid_author: { at: Date.now(), content: author },
          });
        }

        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(res));
          window.sessionStorage.setItem(authorKey(test.slug), JSON.stringify(author));
          if (attempt?.id) window.sessionStorage.setItem(attemptIdKey(test.slug), attempt.id);
          window.sessionStorage.removeItem(storageKey(test.slug));
        }
      } else {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(res));
          if (attempt?.id) window.sessionStorage.setItem(attemptIdKey(test.slug), attempt.id);
          window.sessionStorage.removeItem(storageKey(test.slug));
        }
      }

      router.push(`/tests/${test.slug}/result`);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  const p = priceRub(test);

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
            style={{ width: `${ensureProgress(test.questions.length, answeredCount)}%` }}
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
            Ответь на все пары.
            {test.has_interpretation && p > 0 ? (
              <>
                <span className="text-zinc-500"> </span>
                <span className="text-zinc-900">Первый показ результата этой попытки списывает </span>
                <b className="text-zinc-900">{p} ₽</b>
                <span className="text-zinc-900"> (авторская расшифровка включена).</span>
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
            {busy ? "Обрабатываем…" : buttonLabel(test)}
          </button>
        </div>

        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

        <div className="mt-3 text-xs text-zinc-600">
          Нужно пополнить баланс?{" "}
          <Link href="/wallet" className="underline hover:text-zinc-900">Кошелёк</Link>
        </div>
      </div>
    </Layout>
  );
}

function PairSplitForm({ test }: { test: PairSplitTestV1 }) {
  const router = useRouter();
  const { user, session } = useSession();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [splits, setSplits] = useState<(number | null)[]>(() => {
    const draft = getSessionDraft<(number | null)[]>(test.slug);
    if (draft && Array.isArray(draft) && draft.length === test.questions.length) return draft;
    return Array(test.questions.length).fill(null);
  });

  const answeredCount = useMemo(() => splits.filter((v) => v !== null).length, [splits]);
  const canSubmit = answeredCount === test.questions.length;

  const setSplit = (idx: number, value: number) => {
    setSplits((prev) => {
      const next = [...prev];
      next[idx] = value;
      setSessionDraft(test.slug, next);
      return next;
    });
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");

    try {
      const rawSplits = splits.map((v) => (v ?? 0));
      const res = scorePairSplit(test, rawSplits);

      const userId = user?.id || "guest";
      const attempt = typeof window !== "undefined" ? saveAttempt(userId, test.slug, res) : null;

      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(resultKey(test.slug));
        window.sessionStorage.removeItem(authorKey(test.slug));
        if (attempt?.id) window.sessionStorage.setItem(attemptIdKey(test.slug), attempt.id);
      }

      if (test.has_interpretation && priceRub(test) > 0) {
        if (!user || !session) {
          setError("Для показа результата нужно войти. После входа нажми «Показать результат» ещё раз.");
          router.push(`/auth?next=${encodeURIComponent(`/tests/${test.slug}/take`)}`);
          return;
        }

        const author = await buyAndAttachAuthor({ test, accessToken: session.access_token });

        if (attempt?.id) {
          updateAttempt(userId, test.slug, attempt.id, { paid_author: { at: Date.now(), content: author } });
        }

        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(res));
          window.sessionStorage.setItem(authorKey(test.slug), JSON.stringify(author));
          if (attempt?.id) window.sessionStorage.setItem(attemptIdKey(test.slug), attempt.id);
          window.sessionStorage.removeItem(storageKey(test.slug));
        }
      } else {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(res));
          if (attempt?.id) window.sessionStorage.setItem(attemptIdKey(test.slug), attempt.id);
          window.sessionStorage.removeItem(storageKey(test.slug));
        }
      }

      router.push(`/tests/${test.slug}/result`);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  const p = priceRub(test);

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
            style={{ width: `${ensureProgress(test.questions.length, answeredCount)}%` }}
          />
        </div>

        <div className="mt-3 text-xs text-zinc-600">
          В каждой паре распределите <b>5</b> баллов между утверждениями: <b>0</b> = всё справа, <b>5</b> = всё слева.
        </div>
      </div>

      <div className="grid gap-3">
        {test.questions.map((q, idx) => {
          const left = splits[idx];
          const max = q.maxPoints ?? 5;
          const right = left === null ? null : max - left;

          return (
            <div key={q.order} className="rounded-2xl border bg-white p-4">
              <div className="mb-3 text-sm font-medium text-zinc-900">Пара {q.order}</div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border p-3">
                  <div className="text-xs text-zinc-500">Слева</div>
                  <div className="mt-1 text-sm text-zinc-900">{q.left.text}</div>
                </div>

                <div className="rounded-xl border p-3">
                  <div className="text-xs text-zinc-500">Справа</div>
                  <div className="mt-1 text-sm text-zinc-900">{q.right.text}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="text-xs text-zinc-600">Баллы слева:</div>
                <div className="flex flex-wrap gap-1">
                  {Array.from({ length: max + 1 }).map((_, v) => (
                    <button
                      key={v}
                      onClick={() => setSplit(idx, v)}
                      className={[
                        "h-8 w-8 rounded-lg border text-xs",
                        left === v ? "border-zinc-900 bg-zinc-50 text-zinc-900" : "hover:bg-zinc-50 text-zinc-700",
                      ].join(" ")}
                    >
                      {v}
                    </button>
                  ))}
                </div>

                <div className="ml-auto text-xs text-zinc-600">
                  {left === null ? (
                    <span>выберите 0–{max}</span>
                  ) : (
                    <span>
                      справа: <b className="text-zinc-900">{right}</b>
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-zinc-600">
            Ответь на все пары.
            {test.has_interpretation && p > 0 ? (
              <>
                <span className="text-zinc-500"> </span>
                <span className="text-zinc-900">Первый показ результата этой попытки списывает </span>
                <b className="text-zinc-900">{p} ₽</b>
                <span className="text-zinc-900"> (авторская расшифровка включена).</span>
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
            {busy ? "Обрабатываем…" : buttonLabel(test)}
          </button>
        </div>

        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

        <div className="mt-3 text-xs text-zinc-600">
          Нужно пополнить баланс?{" "}
          <Link href="/wallet" className="underline hover:text-zinc-900">Кошелёк</Link>
        </div>
      </div>
    </Layout>
  );
}

export default function TakeTest({ test }: { test: AnyTest }) {
  // В редких случаях хочется очистить черновик вручную (например, при смене теста)
  const router = useRouter();

  return (
    <>
      {test.type === "forced_pair_v1" || test.type === "forced_pair" ? (
        <ForcedPairForm test={test as ForcedPairTestV1} />
      ) : test.type === "pair_sum5_v1" ? (
        <PairSplitForm test={test as PairSplitTestV1} />
      ) : (
        <Layout title={test.title}>
          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-zinc-900">Неизвестный тип теста: {String(test.type)}</div>
            <div className="mt-3 text-sm text-zinc-600">
              <button
                onClick={() => {
                  clearSession(test.slug);
                  router.replace(`/tests/${test.slug}`);
                }}
                className="rounded-xl border px-3 py-2 text-sm hover:bg-zinc-50"
              >
                Сбросить локальные данные
              </button>
            </div>
          </div>
        </Layout>
      )}
    </>
  );
}

export async function getServerSideProps({ params }: { params: { slug: string } }) {
  const test = await getTestBySlug(params.slug);
  if (!test) return { notFound: true };
  return { props: { test } };
}
