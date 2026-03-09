import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { AnyTest, ABC, TimeManagementTag, LearningTypologyChoice } from "@/lib/testTypes";
import { useSession } from "@/lib/useSession";

function cls(active: boolean) {
  return active
    ? "rounded-xl border border-indigo-300/80 bg-indigo-200/70 px-4 py-3 text-left text-[15px] font-medium leading-snug text-indigo-950"
    : "rounded-xl border border-indigo-100/90 bg-white/85 px-4 py-3 text-left text-[15px] font-medium leading-snug text-slate-900 shadow-sm hover:bg-white/95";
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

const BELBIN_LETTERS = ["A","B","C","D","E","F","G","H"] as const;
type BelbinLetter = typeof BELBIN_LETTERS[number];
const emptyBelbinRow = () => Object.fromEntries(BELBIN_LETTERS.map((L) => [L, 0])) as Record<BelbinLetter, number>;

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
      <div>
        <div className="mb-1 text-[11px] font-semibold text-slate-600">{L}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {leftItems.map((n) => (
            <button key={n} type="button" onClick={() => onChange(n)} className={`${cls(value === n)} text-[13px] sm:text-[15px]`}>
              <div className="flex flex-col gap-1">
                <div className="whitespace-normal break-words">{labelFor(n)}</div>
                <div className={`text-[11px] font-semibold ${value === n ? "text-indigo-950" : "text-slate-500"}`}>{L}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold text-slate-600">{R}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {rightItems.map((n) => (
            <button key={n} type="button" onClick={() => onChange(n)} className={`${cls(value === n)} text-[13px] sm:text-[15px]`}>
              <div className="flex flex-col gap-1">
                <div className="whitespace-normal break-words">{labelFor(n)}</div>
                <div className={`text-[11px] font-semibold ${value === n ? "text-indigo-950" : "text-slate-500"}`}>{R}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function TrainingTake({ test }: { test: AnyTest }) {
  const router = useRouter();
  const roomId = String(router.query.roomId || "");
  const { session, user } = useSession();

  // Dev helper buttons are hidden by default.
  // Enable them with ?dev=1 (or ?debug=1) in the URL.
  const showDevTools = useMemo(() => {
    const raw = (router.query.dev ?? router.query.debug) as string | string[] | undefined;
    const v = Array.isArray(raw) ? raw[0] : raw;
    return v === "1" || v === "true";
  }, [router.query.dev, router.query.debug]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);

  const [forced, setForced] = useState<string[]>(() => Array(test.questions?.length ?? 0).fill(""));
  const [leftPoints, setLeftPoints] = useState<(number | null)[]>(() => Array(test.questions?.length ?? 0).fill(null));
  // Situational guidance (A/B/C/D per situation)
  const [sg, setSg] = useState<("A" | "B" | "C" | "D" | "")[]>(() => Array(test.questions?.length ?? 0).fill(""));
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

  // Belbin (7 sections × A..H allocations)
  const [belbin, setBelbin] = useState<Record<BelbinLetter, number>[]>(() =>
    Array(test.type === "belbin_v1" ? (test.questions?.length ?? 7) : 0).fill(null).map(() => emptyBelbinRow())
  );

  // 16PF draft (A/B/C answers per question)
  const [pf16, setPf16] = useState<(ABC | "")[]>(() => Array(test.questions?.length ?? 0).fill(""));
  const [pf16Gender, setPf16Gender] = useState<"male" | "female" | null>(null);
  const [pf16Age, setPf16Age] = useState<number | null>(null);

  // ЭМИН (Люсин): 46 утверждений, ответы 0..3
  const [emin, setEmin] = useState<(number | null)[]>(() => Array(test.questions?.length ?? 0).fill(null));

  // Тайм-менеджмент: выбор одного из 3 вариантов (L/P/C)
  const [tm, setTm] = useState<(TimeManagementTag | "")[]>(() => Array(test.questions?.length ?? 0).fill(""));

  // Типология личности обучения: выбор A/B/C/D, в некоторых пунктах только 2 варианта
  const [lt, setLt] = useState<(LearningTypologyChoice | "")[]>(() => Array(test.questions?.length ?? 0).fill(""));

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

      // Belbin draft is stored as { belbin: [ {A..H:number} × 7 ] } or directly as array.
      if (test.type === "belbin_v1") {
        const arr = Array.isArray(d) ? (d as any[]) : Array.isArray(d?.belbin) ? (d.belbin as any[]) : Array.isArray(d?.sections) ? (d.sections as any[]) : null;
        if (arr) {
          const rows = arr.slice(0, test.questions?.length ?? 7).map((row: any) => {
            const o: any = emptyBelbinRow();
            for (const L of BELBIN_LETTERS) {
              const v = Number(row?.[L] ?? 0);
              o[L] = Number.isFinite(v) ? Math.max(0, Math.min(10, Math.floor(v))) : 0;
            }
            return o;
          });
          while (rows.length < (test.questions?.length ?? 7)) rows.push(emptyBelbinRow());
          setBelbin(rows as any);
        }
      }

      // 16PF draft is stored as an array of "A"/"B"/"C" (or {pf16:[...]}).
      if (test.type === "16pf_v1") {
        const arr = Array.isArray(d) ? (d as any[]) : Array.isArray(d?.pf16) ? (d.pf16 as any[]) : null;
        if (!arr) return;
        const safe = arr.map((v) => safeABC(v)).slice(0, test.questions?.length ?? 0);
        // Ensure the draft array length matches questions length.
        const full = Array(test.questions?.length ?? 0).fill("") as (ABC | "")[];
        for (let i = 0; i < safe.length; i++) full[i] = safe[i];
        setPf16(full);
        const g = d?.gender === "male" || d?.gender === "female" ? d.gender : null;
        const a = typeof d?.age === "number" && Number.isFinite(d.age) ? d.age : null;
        setPf16Gender(g);
        setPf16Age(a);
      }

      // ЭМИН (Люсин): draft is stored as an array of numbers 0..3 (or { emin:[...] }).
      if (test.type === "emin_v1") {
        const arr = Array.isArray(d) ? (d as any[]) : Array.isArray(d?.emin) ? (d.emin as any[]) : null;
        if (arr) {
          const safe = arr
            .map((v) => {
              const n = Number(v);
              return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.round(n))) : 0;
            })
            .slice(0, test.questions?.length ?? 0);
          const full = Array(test.questions?.length ?? 0).fill(null) as (number | null)[];
          for (let i = 0; i < safe.length; i++) full[i] = safe[i];
          setEmin(full);
        }
      }

      // Тайм-менеджмент: draft is stored as chosen tags L/P/C (or { chosen:[...] }).
      if (test.type === "time_management_v1") {
        const arr = Array.isArray(d) ? (d as any[]) : Array.isArray(d?.chosen) ? (d.chosen as any[]) : Array.isArray(d?.tm) ? (d.tm as any[]) : null;
        if (arr) {
          const safe = arr
            .map((v) => {
              const t = String(v || "").toUpperCase();
              return t === "L" || t === "P" || t === "C" ? (t as TimeManagementTag) : "";
            })
            .slice(0, test.questions?.length ?? 0);
          const full = Array(test.questions?.length ?? 0).fill("") as (TimeManagementTag | "")[];
          for (let i = 0; i < safe.length; i++) full[i] = safe[i];
          setTm(full);
        }
      }

      // Типология личности обучения: draft is stored as chosen A/B/C/D (or { chosen:[...] }).
      if (test.type === "learning_typology_v1") {
        const arr = Array.isArray(d) ? (d as any[]) : Array.isArray(d?.chosen) ? (d.chosen as any[]) : Array.isArray(d?.learning) ? (d.learning as any[]) : null;
        if (arr) {
          const safe = arr
            .map((v) => {
              const t = String(v || "").toUpperCase();
              return t === "A" || t === "B" || t === "C" || t === "D" ? (t as LearningTypologyChoice) : "";
            })
            .slice(0, test.questions?.length ?? 0);
          const full = Array(test.questions?.length ?? 0).fill("") as (LearningTypologyChoice | "")[];
          for (let i = 0; i < safe.length; i++) full[i] = safe[i];
          setLt(full);
        }
      }
    } catch {
      // ignore
    }
  }, [roomId, test?.slug, test?.type, test?.questions?.length]);

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
    if (test.type === "belbin_v1") {
      const want = 10;
      return belbin.filter((row) => {
        const sum = BELBIN_LETTERS.reduce((acc, L) => acc + (Number(row?.[L]) || 0), 0);
        return sum === want;
      }).length;
    }
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
    if (test.type === "16pf_v1") {
      return pf16.filter(Boolean).length;
    }
    if (test.type === "emin_v1") {
      return emin.filter((v) => v !== null).length;
    }
    if (test.type === "time_management_v1") {
      return tm.filter(Boolean).length;
    }
    if (test.type === "learning_typology_v1") {
      return lt.filter(Boolean).length;
    }
    if (test.type === "situational_guidance_v1") {
      return sg.filter(Boolean).length;
    }
    if (test.type === "forced_pair" || test.type === "forced_pair_v1") {
      return forced.filter(Boolean).length;
    }
    return leftPoints.filter((v) => v !== null).length;
  }, [test.type, forced, leftPoints, colorDraft, pf16, emin, tm, lt, sg, belbin]);

  const totalRequired = test.type === "color_types_v1" ? 6 : test.type === "belbin_v1" ? (test.questions?.length ?? 7) : (test.questions?.length ?? 0);
  const pf16AgeOk = typeof pf16Age === "number" && Number.isFinite(pf16Age) && pf16Age >= 16 && pf16Age <= 70;
  const pf16DemoOk = test.type !== "16pf_v1" ? true : ((pf16Gender === "male" || pf16Gender === "female") && pf16AgeOk);
  const canFinish = totalAnswered === totalRequired && pf16DemoOk;

  const submit = async () => {
    if (!session || !user) {
      router.push(`/auth?next=${encodeURIComponent(router.asPath)}`);
      return;
    }
    setErr("");

    const total = totalRequired;
    if (test.type === "16pf_v1") {
      if (pf16Gender !== "male" && pf16Gender !== "female") {
        setErr("Укажите пол (мужчина/женщина). ");
        return;
      }
      if (typeof pf16Age !== "number" || !Number.isFinite(pf16Age) || pf16Age < 16 || pf16Age > 70) {
        setErr("Укажите возраст (16–70 лет). ");
        return;
      }
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
              : test.type === "situational_guidance_v1"
                ? (sg as any)
              : test.type === "16pf_v1"
                ? ({ pf16: pf16 as any, gender: pf16Gender, age: pf16Age } as any)
              : test.type === "belbin_v1"
                ? (belbin as any)
              : test.type === "emin_v1"
                ? (emin.map((v) => (v === null ? 0 : Number(v))) as number[])
              : test.type === "time_management_v1"
                ? (tm.map((v) => (v || "")) as any)
              : test.type === "learning_typology_v1"
                ? (lt.map((v) => (v || "")) as any)
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

  const saveBelbinDraft = (next: Record<BelbinLetter, number>[]) => {
    setBelbin(next);
    try {
      if (typeof window !== "undefined") {
        if (!roomId) return;
        window.sessionStorage.setItem(`training:${roomId}:draft:${test.slug}`, JSON.stringify({ belbin: next }));
      }
    } catch {}
  };

  const savePF16Draft = (next: (ABC | "")[], gender = pf16Gender, age = pf16Age) => {
    setPf16(next);
    try {
      if (typeof window !== "undefined") {
        if (!roomId) return;
        window.sessionStorage.setItem(
          `training:${roomId}:draft:${test.slug}`,
          JSON.stringify({ pf16: next, gender, age })
        );
      }
    } catch {}
  };

  const saveEminDraft = (next: (number | null)[]) => {
    setEmin(next);
    try {
      if (typeof window !== "undefined") {
        if (!roomId) return;
        window.sessionStorage.setItem(`training:${roomId}:draft:${test.slug}`, JSON.stringify({ emin: next }));
      }
    } catch {}
  };

  const saveTimeDraft = (next: (TimeManagementTag | "")[]) => {
    setTm(next);
    try {
      if (typeof window !== "undefined") {
        if (!roomId) return;
        window.sessionStorage.setItem(`training:${roomId}:draft:${test.slug}`, JSON.stringify({ chosen: next }));
      }
    } catch {}
  };

  const saveLearningDraft = (next: (LearningTypologyChoice | "")[]) => {
    setLt(next);
    try {
      if (typeof window !== "undefined") {
        if (!roomId) return;
        window.sessionStorage.setItem(`training:${roomId}:draft:${test.slug}`, JSON.stringify({ chosen: next }));
      }
    } catch {}
  };

  const fillPF16All = (v: ABC) => {
    const next = Array(test.questions?.length ?? 0).fill(v) as (ABC | "")[];
    savePF16Draft(next);
  };

  const clearPF16All = () => {
    const next = Array(test.questions?.length ?? 0).fill("") as (ABC | "")[];
    savePF16Draft(next);
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
        <div className="mb-4 card text-sm text-slate-700">
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
      <div className="mb-4 card text-sm text-slate-700">
        Комната: <span className="font-medium">{roomId}</span>
        <div className="mt-1 text-xs text-slate-500">
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
                <div key={order} className="card">
                  <div className="mb-3 text-sm font-medium text-slate-700">{order}. {q.prompt || "Выберите вариант"}</div>
                  <div className="grid gap-2">
                    {(Object.keys(q.options || {}) as ABC[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={cls(value === k)}
                        onClick={() => patchColor({ [`q${order}`]: k } as any)}
                      >
                        <div className="text-xs font-semibold text-slate-600">Вариант {k}</div>
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
                <div key={order} className="card">
                  <div className="mb-3 text-sm font-medium text-slate-700">{order}. {q.prompt || "Ранжирование"}</div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="card-soft p-3">
                        <div className="text-xs font-semibold text-slate-600">Место {i + 1}</div>
                        <select
                          className="mt-2 input"
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
                  <div className="mt-3 min-h-[22px] text-xs text-slate-600">
                    {ok ? (
                      <>Выбрано: <b className="text-slate-900">{(value.filter(Boolean) as string[]).join(" → ")}</b></>
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
                <div key={order} className="card">
                  <div className="mb-3 text-sm font-medium text-slate-700">{order}. {q.prompt || "Выберите 3"}</div>
                  <div className="grid gap-2">
                    {(Object.keys(q.options || {}) as string[]).map((k) => {
                      const n = Number(k);
                      const active = value.includes(n);
                      return (
                        <button key={k} type="button" className={cls(active)} onClick={() => togglePick(key, n)}>
                          <div className="text-xs font-semibold text-slate-600">{k}</div>
                          <div className="mt-1 text-sm">{q.options?.[k]}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 text-xs text-slate-600">
                    {ok ? (
                      <>Выбрано: <b className="text-slate-900">{value.slice().sort((a, b) => a - b).join(", ")}</b></>
                    ) : (
                      <>Выберите ровно 3 пункта (сейчас: {value.length}).</>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        ) : test.type === "emin_v1" ? (
          <>
            <details className="card">
              <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                Инструкция (нажми, чтобы раскрыть)
              </summary>
              <div className="mt-3 text-sm text-slate-700">
                Прочитайте утверждение и выберите, насколько вы согласны с ним.
              </div>
              <div className="mt-2 text-xs text-slate-600">
                Варианты: 0 — «Совсем не согласен», 1 — «Скорее не согласен», 2 — «Скорее согласен», 3 — «Полностью согласен».
              </div>
            </details>

            {(test.questions || []).map((q: any, idx: number) => {
              const chosen = emin[idx];
              const opts = [
                { v: 0, label: "Совсем не согласен" },
                { v: 1, label: "Скорее не согласен" },
                { v: 2, label: "Скорее согласен" },
                { v: 3, label: "Полностью согласен" },
              ] as const;

              return (
                <div key={idx} className="card">
                  <div className="mb-3 text-sm font-medium text-slate-700">
                    {idx + 1}. {String(q?.text || "")}
                  </div>
                  <div className="grid gap-2">
                    {opts.map((o) => (
                      <button
                        key={o.v}
                        type="button"
                        className={cls(chosen === o.v)}
                        onClick={() => {
                          const next = [...emin];
                          next[idx] = o.v;
                          saveEminDraft(next);
                        }}
                      >
                        <div className="text-sm">{o.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        ) : test.type === "time_management_v1" ? (
          <>
            <details className="card">
              <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                Инструкция (нажми, чтобы раскрыть)
              </summary>
              <div className="mt-3 text-sm text-slate-700">
                В каждом вопросе выбери один вариант. Тест покажет, какой стиль обращения со временем у тебя выражен сильнее.
              </div>
              <div className="mt-2 text-xs text-slate-600">
                L — линейный, P — параллельный, C — циклический стиль. В интерфейсе показываются только формулировки ответов.
              </div>
            </details>

            {(test.questions || []).map((q: any, idx: number) => {
              const chosen = tm[idx] || "";
              const options = Array.isArray(q?.options) ? q.options : [];
              return (
                <div key={idx} className="card">
                  <div className="mb-3 text-sm font-medium text-slate-700">
                    {idx + 1}. {String(q?.text || "")}
                  </div>
                  <div className="grid gap-2">
                    {options.map((o: any, optIdx: number) => {
                      const tag = String(o?.tag || "").toUpperCase();
                      const isActive = chosen === tag;
                      return (
                        <button
                          key={`${idx}:${tag}:${optIdx}`}
                          type="button"
                          className={cls(isActive)}
                          onClick={() => {
                            const next = [...tm];
                            next[idx] = tag === "L" || tag === "P" || tag === "C" ? (tag as TimeManagementTag) : "";
                            saveTimeDraft(next);
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm">{String(o?.text || "")}</div>
                            <div className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] ${isActive ? "border-indigo-400 bg-indigo-100 text-indigo-900" : "border-slate-200 bg-white text-slate-500"}`}>
                              {tag || "—"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        ) : test.type === "learning_typology_v1" ? (
          <>
            <details className="card">
              <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                Инструкция (нажми, чтобы раскрыть)
              </summary>
              <div className="mt-3 text-sm text-slate-700">
                Выбирай по одному варианту в каждом вопросе. Тест показывает, какой стиль обучения и освоения опыта выражен у тебя сильнее.
              </div>
              <div className="mt-2 text-xs text-slate-600">
                Стили считаются автоматически: наблюдатель, экспериментатор, практик и теоретик. В интерфейсе участнику показываются только формулировки ответов.
              </div>
            </details>

            {(test.questions || []).map((q: any, idx: number) => {
              const chosen = lt[idx] || "";
              const options = Array.isArray(q?.options) ? q.options : [];
              return (
                <div key={idx} className="card">
                  <div className="mb-3 text-sm font-medium text-slate-700">
                    {idx + 1}. {String(q?.text || "")}
                  </div>
                  <div className="grid gap-2">
                    {options.map((o: any, optIdx: number) => {
                      const code = String(o?.code || "").toUpperCase();
                      const isActive = chosen === code;
                      return (
                        <button
                          key={`${idx}:${code}:${optIdx}`}
                          type="button"
                          className={cls(isActive)}
                          onClick={() => {
                            const next = [...lt];
                            next[idx] = code === "A" || code === "B" || code === "C" || code === "D" ? (code as LearningTypologyChoice) : "";
                            saveLearningDraft(next);
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="text-sm">{String(o?.text || "")}</div>
                            <div className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] ${isActive ? "border-indigo-400 bg-indigo-100 text-indigo-900" : "border-slate-200 bg-white text-slate-500"}`}>
                              {code || "—"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        ) : test.type === "16pf_v1" ? (
          <>
            <details className="card">
              <summary className="cursor-pointer text-sm font-medium text-zinc-800">
                Инструкция (нажми, чтобы раскрыть)
              </summary>
              <div className="mt-3 text-sm text-slate-700">
                Отвечай быстро и честно, здесь нет правильных ответов.
              </div>
            </details>

            <div className="card">
              <div className="text-xs font-semibold text-slate-600">Данные для нормирования</div>
              <div className="mt-1 text-xs text-slate-600">Пол и возраст нужны только для перевода сырых баллов в стэны по таблицам норм.</div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div>
                  <div className="text-xs text-slate-600">Пол</div>
                  <div className="mt-1 flex gap-2">
                    <button type="button" className={`btn ${pf16Gender === "male" ? "btn-primary" : "btn-ghost"}`} onClick={() => { setPf16Gender("male"); savePF16Draft(pf16, "male", pf16Age); }}>Мужчина</button>
                    <button type="button" className={`btn ${pf16Gender === "female" ? "btn-primary" : "btn-ghost"}`} onClick={() => { setPf16Gender("female"); savePF16Draft(pf16, "female", pf16Age); }}>Женщина</button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-600">Возраст</label>
                  <input
                    type="number"
                    min={16}
                    max={70}
                    inputMode="numeric"
                    className="mt-1 w-[160px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    value={pf16Age ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const n = v === "" ? null : Number(v);
                      const age = typeof n === "number" && Number.isFinite(n) ? n : null;
                      setPf16Age(age);
                      savePF16Draft(pf16, pf16Gender, age);
                    }}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">16–70 лет</div>
                </div>
              </div>
            </div>

            {showDevTools ? (
              <div className="card">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs font-semibold text-slate-600">Тестовый ввод:</div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => fillPF16All("A")}>Все A</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => fillPF16All("B")}>Все B</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => fillPF16All("C")}>Все C</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearPF16All}>Очистить</button>
                </div>
              </div>
            ) : null}

            {(test.questions || []).map((q: any, idx: number) => {
              const chosen = pf16[idx] || "";
              const opts = (q?.options || {}) as Record<ABC, string>;
              return (
                <div key={idx} className="card">
                  <div className="mb-3 text-sm font-medium text-slate-700">
                    {idx + 1}. {String(q?.text || q?.prompt || "")}
                  </div>
                  <div className="grid gap-2">
                    {(["A", "B", "C"] as ABC[]).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={cls(chosen === k)}
                        onClick={() => {
                          const next = [...pf16];
                          next[idx] = k;
                          savePF16Draft(next);
                        }}
                      >
                        <div className="text-xs font-semibold text-slate-600">Вариант {k}</div>
                        <div className="mt-1 text-sm">{opts?.[k] || ""}</div>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          (test.questions || []).map((q: any, idx: number) => {
          if (test.type === "belbin_v1") {
            const row = belbin[idx] || emptyBelbinRow();
            const opts = (q?.options || {}) as Record<string, string>;
            const sum = BELBIN_LETTERS.reduce((acc, L) => acc + (Number(row?.[L]) || 0), 0);
            const ok = sum === 10;
            const left = Math.max(0, 10 - sum);

            const setVal = (L: BelbinLetter, v: number) => {
              const next = [...belbin];
              const cur = { ...(next[idx] || emptyBelbinRow()) } as any;
              // In Belbin each section must allocate exactly 10 points across A–H.
              // Prevent allocating more than the remaining points in the section.
              const raw = Number.isFinite(v) ? Math.floor(v) : 0;
              const curVal = Number(cur?.[L] ?? 0) || 0;
              const sumAll = BELBIN_LETTERS.reduce((acc, X) => acc + (Number(cur?.[X]) || 0), 0);
              const otherSum = sumAll - curVal;
              const maxForLetter = Math.max(0, 10 - otherSum);
              cur[L] = Math.max(0, Math.min(maxForLetter, raw));
              next[idx] = cur;
              saveBelbinDraft(next as any);
            };

            const bump = (L: BelbinLetter, delta: number) => {
              const cur = Number(row?.[L] ?? 0) || 0;
              setVal(L, cur + delta);
            };

            return (
              <div key={idx} className="card">
                <div className="mb-2 text-sm font-medium text-slate-700">{idx + 1}. {String(q?.prompt || "")}</div>

                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-xs text-slate-600">Распределите 10 баллов между A–H</div>
                  <div className={`text-xs font-semibold ${ok ? "text-emerald-700" : "text-amber-700"}`}>
                    Сумма: {sum}/10 · Осталось: {left}
                  </div>
                </div>

                <div className="grid gap-2">
                  {BELBIN_LETTERS.map((L) => (
                    <div key={L} className="rounded-xl border border-slate-200 bg-white/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-600">{L}</div>
                          <div className="mt-1 text-sm text-slate-900 whitespace-normal break-words">{opts?.[L] || ""}</div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          {(() => {
                            const curVal = Number(row?.[L] ?? 0) || 0;
                            const otherSum = sum - curVal;
                            const maxForLetter = Math.max(0, 10 - otherSum);
                            const canDec = curVal > 0;
                            const canInc = curVal < maxForLetter;
                            return (
                              <>
                                <button type="button" className="btn btn-secondary px-3 py-1" disabled={!canDec} onClick={() => bump(L, -1)}>
                                  −
                                </button>
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={0}
                                  max={Math.max(maxForLetter, curVal)}
                                  value={curVal}
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setVal(L, Number.isFinite(v) ? v : 0);
                                  }}
                                  className="w-14 rounded-lg border border-slate-200 bg-white px-2 py-1 text-center text-sm"
                                />
                                <button type="button" className="btn btn-secondary px-3 py-1" disabled={!canInc} onClick={() => bump(L, 1)}>
                                  +
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {!ok ? (
                  <div className="mt-3 text-xs text-amber-700">Сумма в секции должна быть ровно 10.</div>
                ) : null}
              </div>
            );
          }

          if (test.type === "situational_guidance_v1") {
            const chosen = sg[idx] || "";
            const opts = (q?.options || {}) as Record<string, string>;
            const pick = (v: "A" | "B" | "C" | "D") => {
              const next = [...sg];
              next[idx] = v;
              setSg(next);
            };
            return (
              <div key={idx} className="card">
                <div className="mb-3 text-sm font-medium text-slate-700">
                  {idx + 1}. {String(q?.prompt || "")}
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {(["A", "B", "C", "D"] as const).map((k) => (
                    <button key={k} type="button" className={cls(chosen === k)} onClick={() => pick(k)}>
                      <div className="text-xs font-semibold text-slate-600">Вариант {k}</div>
                      <div className="mt-1 text-sm whitespace-normal break-words">{opts?.[k] || ""}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          }
          if (test.type === "forced_pair" || test.type === "forced_pair_v1") {
            const chosen = forced[idx];
            // Some tests may encode pairs as {left,right}, others as options[0/1]. Be defensive.
            const left = (q?.left ?? q?.options?.[0]) as any;
            const right = (q?.right ?? q?.options?.[1]) as any;

            if (!left || !right) {
              return (
                <div key={idx} className="card text-sm text-red-600">
                  Ошибка конфигурации вопроса #{idx + 1}: отсутствуют варианты ответа.
                </div>
              );
            }

            const leftTag = String(left.tag ?? "left");
            const rightTag = String(right.tag ?? "right");
            return (
              <div key={idx} className="card">
                <div className="mb-3 text-sm font-medium text-slate-700">
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
              <div key={idx} className="card">
                <div className="mb-3 text-sm font-medium text-slate-700">
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
                      <div className={`mt-0.5 text-[10px] leading-tight ${v === c.val ? "text-white/80" : "text-slate-500"}`}>
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
            <div key={idx} className="card">
              <div className="mb-3 text-sm font-medium text-slate-700">{idx + 1}. Распределите {max} баллов</div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="card-soft p-3">
                  <div className="text-xs font-semibold text-slate-600">Утверждение 1{leftFactor ? ` (${leftFactor})` : ""}</div>
                  <div className="mt-1 text-sm text-zinc-800">{leftText || "—"}</div>
                </div>
                <div className="card-soft p-3">
                  <div className="text-xs font-semibold text-slate-600">Утверждение 2{rightFactor ? ` (${rightFactor})` : ""}</div>
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
                <div className="mt-2 text-xs text-slate-500">
                  Выбрано: <span className="font-medium">{leftFactor || "A"} {v}</span> /{" "}
                  <span className="font-medium">{rightFactor || "B"} {max - v}</span>
                </div>
              ) : null}
            </div>
          );
        })
        )}
      </div>

      {err ? <div className="mt-4 card text-sm text-red-600">{err}</div> : null}

      <div className="mt-6 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !canFinish}
          className="btn btn-primary disabled:opacity-50"
        >
          {busy ? "Сохраняем…" : `Завершить (${totalAnswered}/${test.type === "color_types_v1" ? 6 : (test.questions?.length ?? 0)})`}
        </button>
        <Link
          href={`/training/rooms/${encodeURIComponent(roomId)}`}
          className="btn btn-secondary"
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
