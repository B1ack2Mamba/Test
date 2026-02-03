import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { AnyTest, ForcedPairTestV1, PairSplitTestV1, ColorTypesTestV1, USKTestV1, PF16TestV1, Tag, ABC } from "@/lib/testTypes";
import { scoreForcedPair, scorePairSplit, scoreColorTypes, scoreUSK, score16PF } from "@/lib/score";
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

// Avoid SSR warnings: layout effect on client, normal effect on server.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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

function cls(active: boolean) {
  return active
    ? "rounded-xl border bg-zinc-900 px-3 py-2 text-left text-sm font-medium leading-tight text-white"
    : "rounded-xl border bg-white px-3 py-2 text-left text-sm font-medium leading-tight text-zinc-900 hover:bg-zinc-50";
}

function cap(s: string) {
  const t = (s || "").trim();
  if (!t) return t;
  return t.slice(0, 1).toUpperCase() + t.slice(1);
}

function SplitScale({
  value,
  onChange,
  max,
  leftWord,
  rightWord,
}: {
  value: number | null;
  onChange: (v: number) => void;
  max: number;
  leftWord?: string;
  rightWord?: string;
}) {
  // Human-friendly 2×3 choice set (still maps to the 6 split values max..0)
  const items = Array.from({ length: max + 1 }, (_, i) => max - i);
  const L = cap(leftWord || "A");
  const R = cap(rightWord || "B");

  const labelFor = (n: number) => {
    if (n === max || n === 0) return "Однозначно";
    if (n === max - 1 || n === 1) return "Да, с большей вероятностью";
    return "Скорее да, чем нет";
  };

  const half = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, half); // max,max-1,max-2
  const rightItems = items.slice(half).reverse(); // 0,1,2

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid grid-cols-3 gap-2">
        {leftItems.map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} className={cls(value === n)}>
            <div>{labelFor(n)}</div>
            <div className={`mt-0.5 text-[10px] ${value === n ? "text-white/80" : "text-zinc-500"}`}>
              {L} {n} / {R} {max - n}
            </div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {rightItems.map((n) => (
          <button key={n} type="button" onClick={() => onChange(n)} className={cls(value === n)}>
            <div>{labelFor(n)}</div>
            <div className={`mt-0.5 text-[10px] ${value === n ? "text-white/80" : "text-zinc-500"}`}>
              {L} {n} / {R} {max - n}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
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

  // IMPORTANT: don't read sessionStorage in the state initializer on an SSR page
  // (it can cause a hydration mismatch if a draft exists on the client).
  const [answers, setAnswers] = useState<(Tag | null)[]>(() => Array(test.questions.length).fill(null));

  useEffect(() => {
    const draft = getSessionDraft<(Tag | null)[]>(test.slug);
    if (draft && Array.isArray(draft) && draft.length === test.questions.length) {
      setAnswers(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.slug, test.questions.length]);

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
                  type="button"
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
                  type="button"
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
            type="button"
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

  // IMPORTANT: don't read sessionStorage in the state initializer on an SSR page
  // (it can cause a hydration mismatch if a draft exists on the client).
  const [splits, setSplits] = useState<(number | null)[]>(() => Array(test.questions.length).fill(null));

  useEffect(() => {
    const draft = getSessionDraft<(number | null)[]>(test.slug);
    if (draft && Array.isArray(draft) && draft.length === test.questions.length) {
      setSplits(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.slug, test.questions.length]);

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
          В каждой паре выберите степень согласия с одним из утверждений (это эквивалент распределения <b>5</b> баллов).
        </div>
      </div>

      <div className="grid gap-3">
        {test.questions.map((q, idx) => {
          const left = splits[idx];
          const rawMax = Number(q.maxPoints ?? 5);
          const max = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 5;
          const right = left === null ? null : max - left;

          const leftFactor = (q as any)?.left?.factor ? String((q as any).left.factor) : "A";
          const rightFactor = (q as any)?.right?.factor ? String((q as any).right.factor) : "B";

          return (
            <div key={q.order} className="rounded-2xl border bg-white p-4">
              <div className="mb-3 text-sm font-medium text-zinc-900">Пара {q.order}</div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border p-3">
                  <div className="text-xs font-semibold text-zinc-600">Вариант {leftFactor}</div>
                  <div className="mt-1 text-sm text-zinc-900">{q.left.text}</div>
                </div>

                <div className="rounded-xl border p-3">
                  <div className="text-xs font-semibold text-zinc-600">Вариант {rightFactor}</div>
                  <div className="mt-1 text-sm text-zinc-900">{q.right.text}</div>
                </div>
              </div>

              <div className="mt-3">
                <SplitScale
                  value={left}
                  onChange={(n) => setSplit(idx, n)}
                  max={max}
                  leftWord={leftFactor}
                  rightWord={rightFactor}
                />
              </div>

              {left !== null ? (
                <div className="mt-2 text-xs text-zinc-500">
                  Выбрано: <span className="font-medium">{leftFactor} {left}</span> /{" "}
                  <span className="font-medium">{rightFactor} {right}</span>
                </div>
              ) : null}
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
            type="button"
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

// ===================== Color types (A/B/C + rankings + pick3) =====================

type ColorDraft = {
  q1: ABC | null;
  q2: ABC | null;
  q3: (ABC | null)[]; // 1..3
  q4: (ABC | null)[];
  q5: number[]; // picked 3 of 1..6
  q6: number[];
};

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function normalizeColorDraft(d: any): ColorDraft {
  return {
    q1: d?.q1 ?? null,
    q2: d?.q2 ?? null,
    q3: Array.isArray(d?.q3) ? d.q3 : [null, null, null],
    q4: Array.isArray(d?.q4) ? d.q4 : [null, null, null],
    q5: Array.isArray(d?.q5) ? d.q5 : [],
    q6: Array.isArray(d?.q6) ? d.q6 : [],
  };
}

function ColorTypesForm({ test }: { test: ColorTypesTestV1 }) {
  const router = useRouter();
  const { user } = useSession();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  // Some browsers can jump scroll to top on long interactive forms when the DOM changes.
  // We keep the user's scroll position stable on the standalone /tests page.
  const scrollGuard = useRef<number | null>(null);
  const captureScroll = () => {
    if (typeof window === "undefined") return;
    // Capture as early as possible (e.g., onMouseDown) and don't overwrite it later.
    if (scrollGuard.current === null) scrollGuard.current = window.scrollY;
  };

  // IMPORTANT: don't read sessionStorage in the state initializer on an SSR page
  // (it can cause a hydration mismatch if a draft exists on the client).
  const [draft, setDraft] = useState<ColorDraft>(() => ({
    q1: null,
    q2: null,
    q3: [null, null, null],
    q4: [null, null, null],
    q5: [],
    q6: [],
  }));

  useIsoLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const saved = scrollGuard.current;
    if (saved === null) return;
    // Only correct if the browser jumped upward noticeably.
    if (window.scrollY + 10 < saved) {
      window.scrollTo({ top: saved, left: 0, behavior: "auto" });
    }
    scrollGuard.current = null;
  }, [draft]);

  useEffect(() => {
    const d = getSessionDraft<ColorDraft>(test.slug);
    if (d && typeof d === "object") {
      setDraft(normalizeColorDraft(d));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.slug]);

  const qByOrder = useMemo(() => {
    const m = new Map<number, any>();
    for (const q of test.questions as any[]) m.set(Number(q.order), q);
    return m;
  }, [test.questions]);

  const isRankOk = (arr: (ABC | null)[]) => arr.length === 3 && arr.every(Boolean) && uniq(arr).length === 3;
  const isPickOk = (arr: number[]) => arr.length === 3 && uniq(arr).length === 3;

  const answeredCount = useMemo(() => {
    let n = 0;
    if (draft.q1) n += 1;
    if (draft.q2) n += 1;
    if (isRankOk(draft.q3)) n += 1;
    if (isRankOk(draft.q4)) n += 1;
    if (isPickOk(draft.q5)) n += 1;
    if (isPickOk(draft.q6)) n += 1;
    return n;
  }, [draft]);

  const canSubmit = answeredCount === 6;

  const patch = (p: Partial<ColorDraft>) => {
    captureScroll();
    setDraft((prev) => {
      const next = { ...prev, ...p };
      setSessionDraft(test.slug, next);
      return next;
    });
  };

  const togglePick = (key: "q5" | "q6", value: number) => {
    captureScroll();
    setDraft((prev) => {
      const cur = Array.isArray((prev as any)[key]) ? ([...(prev as any)[key]] as number[]) : ([] as number[]);
      const has = cur.includes(value);
      let nextArr = cur;
      if (has) {
        nextArr = cur.filter((x) => x !== value);
      } else {
        if (cur.length >= 3) return prev; // ignore extra
        nextArr = [...cur, value];
      }
      const next = { ...prev, [key]: nextArr } as ColorDraft;
      setSessionDraft(test.slug, next);
      return next;
    });
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");

    try {
      const answers = {
        q1: draft.q1 as ABC,
        q2: draft.q2 as ABC,
        q3: (draft.q3 as ABC[]),
        q4: (draft.q4 as ABC[]),
        q5: [...draft.q5],
        q6: [...draft.q6],
      };

      const res = scoreColorTypes(test, answers as any);
      const userId = user?.id || "guest";
      const attempt = typeof window !== "undefined" ? saveAttempt(userId, test.slug, res) : null;

      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(res));
        window.sessionStorage.removeItem(authorKey(test.slug));
        if (attempt?.id) window.sessionStorage.setItem(attemptIdKey(test.slug), attempt.id);
        window.sessionStorage.removeItem(storageKey(test.slug));
      }

      router.push(`/tests/${test.slug}/result`);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  const ChoiceABC = ({ order }: { order: 1 | 2 }) => {
    const q = qByOrder.get(order);
    if (!q) return null;
    const value = (draft as any)[`q${order}`] as ABC | null;
    const set = (v: ABC) => patch({ [`q${order}`]: v } as any);
    return (
      <div className="rounded-2xl border bg-white p-4">
        <div className="mb-2 text-sm font-medium text-zinc-900">{order}. {q.prompt}</div>
        <div className="grid gap-2">
          {(Object.keys(q.options || {}) as ABC[]).map((k) => (
            <button
              key={k}
              type="button"
              onMouseDown={captureScroll}
              className={cls(value === k)}
              onClick={() => set(k)}
            >
              <div className="text-xs font-semibold text-zinc-600">Вариант {k}</div>
              <div className="mt-1 text-sm">{q.options[k]}</div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const RankABC = ({ order }: { order: 3 | 4 }) => {
    const q = qByOrder.get(order);
    if (!q) return null;
    const value = (draft as any)[`q${order}`] as (ABC | null)[];
    const setAt = (idx: number, v: ABC | "") => {
      const next = [...(value || [null, null, null])];
      const newVal = v ? (v as ABC) : null;
      next[idx] = newVal;
      // Prevent duplicates: if user selects an already chosen option, clear it in the other slot.
      if (newVal) {
        for (let j = 0; j < next.length; j++) {
          if (j !== idx && next[j] === newVal) next[j] = null;
        }
      }
      patch({ [`q${order}`]: next } as any);
    };

    const chosen = (value || []).filter(Boolean) as ABC[];
    const ok = isRankOk(value || []);

    return (
      <div className="rounded-2xl border bg-white p-4">
        <div className="mb-2 text-sm font-medium text-zinc-900">{order}. {q.prompt}</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border bg-zinc-50 p-3">
              <div className="text-xs font-semibold text-zinc-600">Место {i + 1}</div>
              <select
                className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                value={value?.[i] ?? ""}
                onMouseDown={captureScroll}
                onFocus={captureScroll}
                onChange={(e) => setAt(i, (e.target.value as any) || "")}
              >
                <option value="">— выбрать —</option>
                {(Object.keys(q.options || {}) as ABC[]).map((k) => (
                  <option
                    key={k}
                    value={k}
                    // Disable options already selected in other positions
                    disabled={(value || []).some((vv, idx) => idx !== i && vv === k)}
                  >
                    {k} — {String(q.options[k] || "").slice(0, 80)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-2">
          {(Object.keys(q.options || {}) as ABC[]).map((k) => (
            <div key={k} className="rounded-xl border bg-white p-3 text-sm">
              <div className="text-xs font-semibold text-zinc-600">{k}</div>
              <div className="mt-1 text-zinc-800">{q.options[k]}</div>
            </div>
          ))}
        </div>

        {/* Keep a stable block height to avoid small layout shifts ("jitter") when the hint text changes */}
        <div className="mt-3 min-h-[22px] text-xs text-zinc-600">
          {ok ? (
            <>Выбрано: <b className="text-zinc-900">{chosen.join(" → ")}</b></>
          ) : (
            <>Нужно выбрать все 3 места без повторов.</>
          )}
        </div>
      </div>
    );
  };

  const Pick3 = ({ order }: { order: 5 | 6 }) => {
    const q = qByOrder.get(order);
    if (!q) return null;
    const key = `q${order}` as "q5" | "q6";
    const value = (draft as any)[key] as number[];
    const ok = isPickOk(value || []);
    return (
      <div className="rounded-2xl border bg-white p-4">
        <div className="mb-2 text-sm font-medium text-zinc-900">{order}. {q.prompt}</div>
        <div className="grid gap-2">
          {(Object.keys(q.options || {}) as string[]).map((k) => {
            const n = Number(k);
            const active = (value || []).includes(n);
            return (
              <button
                key={k}
                type="button"
                onMouseDown={captureScroll}
                onClick={() => togglePick(key, n)}
                className={cls(active)}
              >
                <div className="text-xs font-semibold text-zinc-600">{k}</div>
                <div className="mt-1 text-sm">{q.options[k]}</div>
              </button>
            );
          })}
        </div>
        {/* Keep a stable block height to avoid small layout shifts ("jitter") when the hint text changes */}
        <div className="mt-3 min-h-[22px] text-xs text-zinc-600">
          {ok ? (
            <>Выбрано: <b className="text-zinc-900">{(value || []).slice().sort((a, b) => a - b).join(", ")}</b></>
          ) : (
            <>Выберите ровно 3 пункта (сейчас: {(value || []).length}).</>
          )}
        </div>
      </div>
    );
  };

  return (
    <Layout title={test.title}>
      <div className="mb-4 rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-zinc-600">
            Прогресс: <span className="font-medium text-zinc-900">{answeredCount}/6</span>
          </div>
          <Link href={`/tests/${test.slug}`} className="text-sm text-zinc-600 hover:text-zinc-900">
            ← к описанию
          </Link>
        </div>

        <div className="mt-3 h-2 w-full rounded-full bg-zinc-100">
          <div className="h-2 rounded-full bg-zinc-900 transition-all" style={{ width: `${ensureProgress(6, answeredCount)}%` }} />
        </div>

        <div className="mt-3 text-xs text-zinc-600">Отвечайте честно — тест считает три показателя: зелёный, красный и синий.</div>
      </div>

      <div className="grid gap-3">
        <ChoiceABC order={1} />
        <ChoiceABC order={2} />
        <RankABC order={3} />
        <RankABC order={4} />
        <Pick3 order={5} />
        <Pick3 order={6} />
      </div>

      <div className="mt-6 rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-zinc-600">Ответьте на все 6 ситуаций, чтобы увидеть результат.</div>
          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={submit}
            className={[
              "rounded-xl px-4 py-2 text-sm font-medium text-white",
              canSubmit && !busy ? "bg-zinc-900 hover:bg-zinc-800" : "cursor-not-allowed bg-zinc-300",
            ].join(" ")}
          >
            {busy ? "Обрабатываем…" : "Показать результат"}
          </button>
        </div>
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>
    </Layout>
  );
}

function USKForm({ test }: { test: USKTestV1 }) {
  const router = useRouter();
  const { user, session } = useSession();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [answers, setAnswers] = useState<(number | null)[]>(() => Array(test.questions.length).fill(null));

  useEffect(() => {
    const draft = getSessionDraft<(number | null)[]>(test.slug);
    if (draft && Array.isArray(draft) && draft.length === test.questions.length) {
      setAnswers(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.slug, test.questions.length]);

  const answeredCount = useMemo(() => answers.filter((v) => v !== null).length, [answers]);
  const canSubmit = answeredCount === test.questions.length;

  const pick = (idx: number, v: number) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = v;
      setSessionDraft(test.slug, next);
      return next;
    });
  };

  const CHOICES: { v: number; label: string }[] = [
    { v: -3, label: "Полностью не согласен" },
    { v: -2, label: "Скорее не согласен" },
    { v: -1, label: "Скорее не согласен, чем согласен" },
    { v: 0, label: "Нет ответа" },
    { v: 1, label: "Скорее согласен, чем нет" },
    { v: 2, label: "Скорее согласен" },
    { v: 3, label: "Полностью согласен" },
  ];

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");

    try {
      const vals = answers.map((v) => (v === null ? 0 : v));
      const res = scoreUSK(test, vals);

      const userId = user?.id || "guest";
      const attempt = typeof window !== "undefined" ? saveAttempt(userId, test.slug, res) : null;

      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(resultKey(test.slug));
        window.sessionStorage.removeItem(authorKey(test.slug));
        if (attempt?.id) window.sessionStorage.setItem(attemptIdKey(test.slug), attempt.id);
      }

      // Paid interpretation (if enabled)
      if (test.has_interpretation && priceRub(test) > 0) {
        if (!user || !session) {
          setError("Для показа результата нужно войти. После входа нажми «Показать результат» ещё раз.");
          router.push(`/auth?next=${encodeURIComponent(`/tests/${test.slug}/take`)}`);
          return;
        }

        const author = await buyAndAttachAuthor({ test, accessToken: session.access_token });

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
          Шкала ответов: −3…3 (можно выбрать «Нет ответа», это 0 баллов).
        </div>
      </div>

      <div className="grid gap-3">
        {test.questions.map((q, idx) => (
          <div key={q.order} className="rounded-2xl border bg-white p-4">
            <div className="text-sm font-semibold text-zinc-900">{q.order}. {q.text}</div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-7">
              {CHOICES.map((c) => (
                <button
                  key={c.v}
                  type="button"
                  onClick={() => pick(idx, c.v)}
                  className={cls(answers[idx] === c.v)}
                >
                  <div className="text-xs font-semibold">{c.v}</div>
                  <div className={`mt-1 text-[10px] leading-tight ${answers[idx] === c.v ? "text-white/80" : "text-zinc-500"}`}>
                    {c.label}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-zinc-600">Ответьте на все утверждения, чтобы увидеть результат.</div>
          <button
            type="button"
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
      </div>
    </Layout>
  );
}


function PF16Form({ test }: { test: PF16TestV1 }) {
  const router = useRouter();
  const { user } = useSession();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [answers, setAnswers] = useState<(ABC | "")[]>(() => Array(test.questions.length).fill(""));

  useEffect(() => {
    const draft = getSessionDraft<(ABC | "")[]>(test.slug);
    if (draft && Array.isArray(draft) && draft.length === test.questions.length) {
      setAnswers(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [test.slug, test.questions.length]);

  const answeredCount = useMemo(() => answers.filter(Boolean).length, [answers]);
  const canSubmit = answeredCount === test.questions.length;

  const pick = (idx: number, v: ABC) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = v;
      setSessionDraft(test.slug, next);
      return next;
    });
  };

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");

    try {
      const res = score16PF(test, answers);

      const userId = user?.id || "guest";
      const attempt = typeof window !== "undefined" ? saveAttempt(userId, test.slug, res) : null;

      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(res));
        window.sessionStorage.removeItem(authorKey(test.slug));
        if (attempt?.id) window.sessionStorage.setItem(attemptIdKey(test.slug), attempt.id);
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
          <div>
            <div className="text-sm font-semibold text-zinc-900">Прогресс</div>
            <div className="mt-1 text-sm text-zinc-600">
              Отвечено: {answeredCount}/{test.questions.length} (вопрос 187 — контрольный, в результат не входит)
            </div>
          </div>
        </div>

        <details className="mt-4 rounded-2xl border bg-zinc-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-900">Инструкция</summary>
          <div className="mt-2 space-y-2 text-sm text-zinc-700">
            <p>В каждом вопросе выбери один вариант (A / B / C). Отвечай быстро, не «вычисляя правильный ответ».</p>
            <p>Результат считается по 16 факторам. Оценка каждого фактора — 0–10 (округление).</p>
            <p>Порог уровней: 0–4 — низкий, 5–7 — средний, 8–10 — высокий.</p>
            <p>Вопрос №187 — контрольный, он не влияет на факторы (но оставлен в тесте).</p>
          </div>
        </details>
      </div>

      <div className="space-y-3">
        {test.questions.map((q, i) => (
          <div key={q.order} className="rounded-2xl border bg-white p-4">
            <div className="text-sm font-semibold text-zinc-900">
              {q.order}. {q.text}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button type="button" className={cls(answers[i] === "A")} onClick={() => pick(i, "A")}>
                A — {(q as any).options?.A ?? ""}
              </button>
              <button type="button" className={cls(answers[i] === "B")} onClick={() => pick(i, "B")}>
                B — {(q as any).options?.B ?? ""}
              </button>
              <button type="button" className={cls(answers[i] === "C")} onClick={() => pick(i, "C")}>
                C — {(q as any).options?.C ?? ""}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || busy}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Сохраняем…" : "Показать результат"}
        </button>
      </div>

      {error ? <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
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
      ) : test.type === "color_types_v1" ? (
        <ColorTypesForm test={test as ColorTypesTestV1} />
      ) : test.type === "usk_v1" ? (
        <USKForm test={test as USKTestV1} />
      ) : test.type === "16pf_v1" ? (
        <PF16Form test={test as PF16TestV1} />
      ) : (
        <Layout title={test.title}>
          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm text-zinc-900">Неизвестный тип теста: {String(test.type)}</div>
            <div className="mt-3 text-sm text-zinc-600">
              <button
                type="button"
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
