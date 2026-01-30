import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { AnyTest, ColorTypesTestV1, ABC } from "@/lib/testTypes";
import { useSession } from "@/lib/useSession";

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

// Color types draft (answers are stored as an object for this test)
type ColorDraft = {
  q1: ABC | "";
  q2: ABC | "";
  q3: [ABC | "", ABC | "", ABC | ""]; // 1..3
  q4: [ABC | "", ABC | "", ABC | ""];
  q5: number[]; // picked 3 of 1..6
  q6: number[];
};

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
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
  // IMPORTANT: для мотивационных карт удобнее показывать 3 варианта под каждым утверждением,
  // чтобы пользователь выбирал "степень согласия" с левым или правым утверждением.
  // По сути это всё те же 6 раскладок (5/0..0/5), но визуально делим их на 2×3.
  const items = Array.from({ length: max + 1 }, (_, i) => max - i);
  const L = cap(leftWord || "A");
  const R = cap(rightWord || "B");

  // Хотим человеческие кнопки без "лево/право".
  // Формулировки симметричны, а распределение баллов показываем ниже (A/B).
  const labelFor = (n: number) => {
    if (n === max || n === 0) return "Однозначно";
    if (n === max - 1 || n === 1) return "Да, с большей вероятностью";
    return "Скорее да, чем нет";
  };

  const half = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, half);
  // Под правым утверждением показываем те же 3 уровня, но логически: "Однозначно" → "Скорее".
  const rightItems = items.slice(half).reverse();

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

export default function TrainingTake({ test }: { test: AnyTest }) {
  const router = useRouter();
  const roomId = String(router.query.roomId || "");
  const { session, user } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);

  const [forced, setForced] = useState<string[]>(() => Array(test.questions?.length ?? 0).fill(""));
  const [leftPoints, setLeftPoints] = useState<(number | null)[]>(() => Array(test.questions?.length ?? 0).fill(null));
  // IMPORTANT: don't read sessionStorage in the state initializer on an SSR page
  // (it can cause a hydration mismatch if a draft exists on the client).
  const [colorDraft, setColorDraft] = useState<ColorDraft>({
    q1: "",
    q2: "",
    q3: ["", "", ""],
    q4: ["", "", ""],
    q5: [],
    q6: [],
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Wait for router to provide the real roomId before reading the draft.
    if (!roomId || !test?.slug) return;
    try {
      const raw = window.sessionStorage.getItem(`training:${roomId}:draft:${test.slug}`);
      const d = raw ? JSON.parse(raw) : null;
      const safeABC = (v: any): ABC | "" => (v === "A" || v === "B" || v === "C" ? v : "");
      const safeRank = (arr: any): [ABC | "", ABC | "", ABC | ""] => {
        const a = Array.isArray(arr) ? arr : [];
        return [safeABC(a[0]), safeABC(a[1]), safeABC(a[2])];
      };
      const safePick = (arr: any) =>
        (Array.isArray(arr) ? arr : [])
          .map((x: any) => Number(x))
          .filter((n: any) => Number.isFinite(n) && n >= 1 && n <= 6)
          .slice(0, 3);
      setColorDraft({
        q1: safeABC(d?.q1),
        q2: safeABC(d?.q2),
        q3: safeRank(d?.q3),
        q4: safeRank(d?.q4),
        q5: safePick(d?.q5),
        q6: safePick(d?.q6),
      });
    } catch {
      // ignore
    }
  }, [roomId, test?.slug]);

  useEffect(() => {
    if (!session || !roomId || !test?.slug) return;
    (async () => {
      try {
        const r = await fetch(`/api/training/rooms/tests/get?room_id=${encodeURIComponent(roomId)}`, {
          headers: { authorization: `Bearer ${session.access_token}` },
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) return;
        const slugs = (j.room_tests || []).map((x: any) => String(x.test_slug));
        setIsEnabled(slugs.includes(test.slug));
      } catch {
        // ignore
      }
    })();
  }, [session?.access_token, roomId, test?.slug]);


  const totalAnswered = useMemo(() => {
    if (test.type === "color_types_v1") {
      const rankOk = (r: (ABC | "")[]) => r.length === 3 && r.every(Boolean) && uniq(r).length === 3;
      const pickOk = (a: number[]) => a.length === 3 && uniq(a).length === 3;
      let n = 0;
      if (colorDraft.q1) n++;
      if (colorDraft.q2) n++;
      if (rankOk(colorDraft.q3)) n++;
      if (rankOk(colorDraft.q4)) n++;
      if (pickOk(colorDraft.q5)) n++;
      if (pickOk(colorDraft.q6)) n++;
      return n;
    }
    if (test.type === "forced_pair" || test.type === "forced_pair_v1") {
      return forced.filter(Boolean).length;
    }
    return leftPoints.filter((v) => v !== null).length;
  }, [test.type, forced, leftPoints, colorDraft]);

  const submit = async () => {
    if (!session || !user) {
      router.push(`/auth?next=${encodeURIComponent(router.asPath)}`);
      return;
    }
    setErr("");

    const total = test.type === "color_types_v1" ? 6 : (test.questions?.length ?? 0);
    if (totalAnswered < total) {
      setErr("Ответьте на все вопросы.");
      return;
    }

    setBusy(true);
    try {
      const answers =
        test.type === "forced_pair" || test.type === "forced_pair_v1"
          ? forced
          : test.type === "color_types_v1"
            ? {
                q1: colorDraft.q1,
                q2: colorDraft.q2,
                q3: [...colorDraft.q3],
                q4: [...colorDraft.q4],
                q5: [...colorDraft.q5],
                q6: [...colorDraft.q6],
              }
            : test.type === "usk_v1"
              ? (leftPoints.map((v) => (v === null ? 0 : Number(v))) as number[])
              : (leftPoints.map((v) => Number(v)) as number[]);

      const r = await fetch("/api/training/attempts/submit", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: roomId, test_slug: test.slug, answers }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось сохранить попытку");

      const attemptId = j.attempt_id as string;

      // local history per-room (minimal)
      try {
        const key = `training:${roomId}:history`;
        const raw = window.localStorage.getItem(key);
        const list = raw ? (JSON.parse(raw) as any[]) : [];
        list.unshift({ test_slug: test.slug, attempt_id: attemptId, at: Date.now() });
        window.localStorage.setItem(key, JSON.stringify(list.slice(0, 50)));
      } catch {}

      router.push(
        `/training/rooms/${encodeURIComponent(roomId)}/tests/${encodeURIComponent(test.slug)}/done?attempt=${encodeURIComponent(
          attemptId
        )}`
      );
    } catch (e: any) {
      setErr(e?.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  const saveColorDraft = (next: ColorDraft) => {
    setColorDraft(next);
    try {
      if (typeof window !== "undefined") {
        if (!roomId) return;
        window.sessionStorage.setItem(`training:${roomId}:draft:${test.slug}`, JSON.stringify(next));
      }
    } catch {}
  };

  const patchColor = (p: Partial<ColorDraft>) => {
    saveColorDraft({ ...colorDraft, ...p });
  };

  const togglePick = (key: "q5" | "q6", value: number) => {
    const cur = (colorDraft as any)[key] as number[];
    const has = cur.includes(value);
    if (has) {
      patchColor({ [key]: cur.filter((x) => x !== value) } as any);
      return;
    }
    if (cur.length >= 3) return;
    patchColor({ [key]: [...cur, value] } as any);
  };

  const qByOrder = useMemo(() => {
    const m = new Map<number, any>();
    for (const q of (test.questions || []) as any[]) m.set(Number(q.order), q);
    return m;
  }, [test.questions]);

  if (!isEnabled) {
    return (
      <Layout title={test.title}>
        <div className="mb-4 rounded-2xl border bg-white p-4 text-sm text-zinc-700">
          Комната: <span className="font-medium">{roomId}</span>
        </div>

        <div className="rounded-2xl border bg-amber-50 p-4 text-sm text-amber-900">
          Этот тест выключен для этой комнаты.
          <div className="mt-3">
            <Link href={`/training/rooms/${encodeURIComponent(roomId)}`} className="text-sm font-medium underline">
              ← Назад в комнату
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={test.title}>
      <div className="mb-4 rounded-2xl border bg-white p-4 text-sm text-zinc-700">
        Комната: <span className="font-medium">{roomId}</span>
        <div className="mt-1 text-xs text-zinc-500">
          Результаты в цифрах будут доступны специалисту. Вы увидите только статус «завершено».
        </div>
      </div>

      <div className="grid gap-3">
        {test.type === "color_types_v1" ? (
          <>
            {[1, 2].map((order) => {
              const q = qByOrder.get(order) || {};
              const value = (colorDraft as any)[`q${order}`] as ABC | "";
              return (
                <div key={order} className="rounded-2xl border bg-white p-4">
                  <div className="mb-3 text-sm font-medium text-zinc-700">{order}. {q.prompt || "Выберите вариант"}</div>
                  <div className="grid gap-2">
                    {(Object.keys(q.options || {}) as ABC[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={cls(value === k)}
                        onClick={() => patchColor({ [`q${order}`]: k } as any)}
                      >
                        <div className="text-xs font-semibold text-zinc-600">Вариант {k}</div>
                        <div className="mt-1 text-sm">{q.options?.[k]}</div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {[3, 4].map((order) => {
              const q = qByOrder.get(order) || {};
              const value = (colorDraft as any)[`q${order}`] as [ABC | "", ABC | "", ABC | ""];
              const setAt = (idx: number, v: ABC | "") => {
                const next = [...value] as any;
                next[idx] = v;
                // Prevent duplicates: if user selects an already chosen option, clear it in the other slot.
                if (v) {
                  for (let j = 0; j < next.length; j++) {
                    if (j !== idx && next[j] === v) next[j] = "";
                  }
                }
                patchColor({ [`q${order}`]: next } as any);
              };
              const ok = value.filter(Boolean).length === 3 && new Set(value.filter(Boolean)).size === 3;
              return (
                <div key={order} className="rounded-2xl border bg-white p-4">
                  <div className="mb-3 text-sm font-medium text-zinc-700">{order}. {q.prompt || "Ранжирование"}</div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="rounded-xl border bg-zinc-50 p-3">
                        <div className="text-xs font-semibold text-zinc-600">Место {i + 1}</div>
                        <select
                          className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm"
                          value={value?.[i] || ""}
                          onChange={(e) => setAt(i, (e.target.value as any) || "")}
                        >
                          <option value="">— выбрать —</option>
                          {(Object.keys(q.options || {}) as ABC[]).map((k) => (
                            <option
                              key={k}
                              value={k}
                              // Disable options already selected in other positions
                              disabled={(value || []).some((vv, pos) => pos !== i && vv === k)}
                            >
                              {k} — {String(q.options?.[k] || "").slice(0, 80)}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  {/* Keep a stable block height to avoid small layout shifts */}
                  <div className="mt-3 min-h-[22px] text-xs text-zinc-600">
                    {ok ? (
                      <>Выбрано: <b className="text-zinc-900">{(value.filter(Boolean) as string[]).join(" → ")}</b></>
                    ) : (
                      <>Нужно выбрать все 3 места без повторов.</>
                    )}
                  </div>
                </div>
              );
            })}

            {[5, 6].map((order) => {
              const q = qByOrder.get(order) || {};
              const key = `q${order}` as "q5" | "q6";
              const value = (colorDraft as any)[key] as number[];
              const ok = value.length === 3 && new Set(value).size === 3;
              return (
                <div key={order} className="rounded-2xl border bg-white p-4">
                  <div className="mb-3 text-sm font-medium text-zinc-700">{order}. {q.prompt || "Выберите 3"}</div>
                  <div className="grid gap-2">
                    {(Object.keys(q.options || {}) as string[]).map((k) => {
                      const n = Number(k);
                      const active = value.includes(n);
                      return (
                        <button key={k} type="button" className={cls(active)} onClick={() => togglePick(key, n)}>
                          <div className="text-xs font-semibold text-zinc-600">{k}</div>
                          <div className="mt-1 text-sm">{q.options?.[k]}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 text-xs text-zinc-600">
                    {ok ? (
                      <>Выбрано: <b className="text-zinc-900">{value.slice().sort((a, b) => a - b).join(", ")}</b></>
                    ) : (
                      <>Выберите ровно 3 пункта (сейчас: {value.length}).</>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          (test.questions || []).map((q: any, idx: number) => {
          if (test.type === "forced_pair" || test.type === "forced_pair_v1") {
            const chosen = forced[idx];
            // Some tests may encode pairs as {left,right}, others as options[0/1]. Be defensive.
            const left = (q?.left ?? q?.options?.[0]) as any;
            const right = (q?.right ?? q?.options?.[1]) as any;

            if (!left || !right) {
              return (
                <div key={idx} className="rounded-2xl border bg-white p-4 text-sm text-red-600">
                  Ошибка конфигурации вопроса #{idx + 1}: отсутствуют варианты ответа.
                </div>
              );
            }

            const leftTag = String(left.tag ?? "left");
            const rightTag = String(right.tag ?? "right");
            return (
              <div key={idx} className="rounded-2xl border bg-white p-4">
                <div className="mb-3 text-sm font-medium text-zinc-700">
                  {idx + 1}. {q.prompt || "Выберите вариант"}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    className={cls(chosen === leftTag)}
                    onClick={() => {
                      const next = [...forced];
                      next[idx] = leftTag;
                      setForced(next);
                    }}
                  >
                    {left.text ?? left.label ?? "Вариант A"}
                  </button>
                  <button
                    type="button"
                    className={cls(chosen === rightTag)}
                    onClick={() => {
                      const next = [...forced];
                      next[idx] = rightTag;
                      setForced(next);
                    }}
                  >
                    {right.text ?? right.label ?? "Вариант B"}
                  </button>
                </div>
              </div>
            );
          }

          if (test.type === "usk_v1") {
            const v = leftPoints[idx];
            const CHOICES: { val: number; label: string }[] = [
              { val: -3, label: "Полностью не согласен" },
              { val: -2, label: "Скорее не согласен" },
              { val: -1, label: "Скорее не согласен, чем согласен" },
              { val: 0, label: "Нет ответа" },
              { val: 1, label: "Скорее согласен, чем нет" },
              { val: 2, label: "Скорее согласен" },
              { val: 3, label: "Полностью согласен" },
            ];
            return (
              <div key={idx} className="rounded-2xl border bg-white p-4">
                <div className="mb-3 text-sm font-medium text-zinc-700">
                  {idx + 1}. {String((q as any)?.text || (q as any)?.prompt || "")}
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
                  {CHOICES.map((c) => (
                    <button
                      key={c.val}
                      type="button"
                      className={cls(v === c.val)}
                      onClick={() => {
                        const next = [...leftPoints];
                        next[idx] = c.val;
                        setLeftPoints(next);
                      }}
                    >
                      <div className="text-xs font-semibold">{c.val}</div>
                      <div className={`mt-0.5 text-[10px] leading-tight ${v === c.val ? "text-white/80" : "text-zinc-500"}`}>
                        {c.label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          // pair_sum5_v1
          const v = leftPoints[idx];
          const rawMax = Number((q as any)?.maxPoints ?? 5);
          const max = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 5;
          const leftFactor = (q as any)?.left?.factor ? String((q as any).left.factor) : "";
          const rightFactor = (q as any)?.right?.factor ? String((q as any).right.factor) : "";
          const leftText = String((q as any)?.left?.text ?? (q as any)?.left?.label ?? "").trim();
          const rightText = String((q as any)?.right?.text ?? (q as any)?.right?.label ?? "").trim();
          return (
            <div key={idx} className="rounded-2xl border bg-white p-4">
              <div className="mb-3 text-sm font-medium text-zinc-700">{idx + 1}. Распределите {max} баллов</div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border bg-zinc-50 p-3">
                  <div className="text-xs font-semibold text-zinc-600">Утверждение 1{leftFactor ? ` (${leftFactor})` : ""}</div>
                  <div className="mt-1 text-sm text-zinc-800">{leftText || "—"}</div>
                </div>
                <div className="rounded-xl border bg-zinc-50 p-3">
                  <div className="text-xs font-semibold text-zinc-600">Утверждение 2{rightFactor ? ` (${rightFactor})` : ""}</div>
                  <div className="mt-1 text-sm text-zinc-800">{rightText || "—"}</div>
                </div>
              </div>

              <div className="mt-3">
                <SplitScale
                  value={v}
                  onChange={(n) => {
                    const next = [...leftPoints];
                    next[idx] = n;
                    setLeftPoints(next);
                  }}
                  max={max}
                  leftWord={leftFactor || "A"}
                  rightWord={rightFactor || "B"}
                />
              </div>

              {v !== null ? (
                <div className="mt-2 text-xs text-zinc-500">
                  Выбрано: <span className="font-medium">{leftFactor || "A"} {v}</span> /{" "}
                  <span className="font-medium">{rightFactor || "B"} {max - v}</span>
                </div>
              ) : null}
            </div>
          );
        })
        )}
      </div>

      {err ? <div className="mt-4 rounded-2xl border bg-white p-4 text-sm text-red-600">{err}</div> : null}

      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Сохраняем…" : `Завершить (${totalAnswered}/${test.type === "color_types_v1" ? 6 : (test.questions?.length ?? 0)})`}
        </button>
        <Link
          href={`/training/rooms/${encodeURIComponent(roomId)}`}
          className="rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
        >
          Назад
        </Link>
      </div>
    </Layout>
  );
}

export async function getServerSideProps(ctx: any) {
  const slug = String(ctx.params?.slug || "");
  const test = await getTestBySlug(slug);
  if (!test) return { notFound: true };
  return { props: { test } };
}
