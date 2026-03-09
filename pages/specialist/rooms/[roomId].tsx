import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";
import { isSpecialistUser } from "@/lib/specialist";
import type { AnyTest } from "@/lib/testTypes";
import type { ScoreResult } from "@/lib/score";

type Props = { tests: AnyTest[] };

type Member = {
  id: string;
  user_id: string;
  display_name: string;
  role: "participant" | "specialist";
  last_seen: string;
  online: boolean;
};

type Progress = {
  room_id: string;
  user_id: string;
  test_slug: string;
  started_at: string | null;
  completed_at: string | null;
  attempt_id: string | null;
};

function Digits({ result }: { result: ScoreResult }) {
  const kind = result.kind;
  const [showTabidze, setShowTabidze] = useState(false);
  if (kind === "16pf_v1") {
    const meta: any = (result.meta as any) || {};
    const rawByFactor = meta.rawByFactor || {};
    const maxByFactor = meta.maxByFactor || {};
    const maxRawByFactor = meta.maxRawByFactor || {};
    const stenByFactor = meta.stenByFactor || {};
    const secondary = meta.secondary || {};
    const secondaryNames: Record<string, string> = {
      F1: "Экстраверсия - интроверсия",
      F2: "Низкая тревожность - Высокая тревожность",
      F3: "Сензитивность - стабильность",
      F4: "Покорность - независимость",
    };
    const tabidzeGroups = [
      { title: "Эмоциональные качества", factors: ["C", "L", "O", "Q4"] },
      { title: "Волевые качества", factors: ["E", "H", "G", "Q3"] },
      { title: "Коммуникативные качества", factors: ["A", "F", "I", "Q2"] },
      { title: "Интеллектуальные качества", factors: ["B", "M", "N", "Q1"] },
    ] as const;

    const invertSet = new Set(["L", "O", "Q4"]);
    const poles: Record<string, { neg: string; pos: string }> = {
      C: { neg: "Эмоциональная неустойчивость", pos: "Эмоциональная устойчивость" },
      L: { neg: "Подозрительность", pos: "Доверчивость" },
      O: { neg: "Тревожность", pos: "Спокойствие" },
      Q4: { neg: "Напряжённость", pos: "Расслабленность" },

      E: { neg: "Подчинённость", pos: "Властность" },
      H: { neg: "Робость", pos: "Смелость" },
      G: { neg: "Небрежность", pos: "Ответственность" },
      Q3: { neg: "Низкий самоконтроль", pos: "Высокий самоконтроль" },

      A: { neg: "Отчуждённость", pos: "Общительность" },
      F: { neg: "Пессимизм", pos: "Оптимизм" },
      I: { neg: "Жёсткость", pos: "Мягкосердечие" },
      Q2: { neg: "Зависимость от группы", pos: "Самостоятельность" },

      B: { neg: "Низкий интеллект", pos: "Высокий интеллект" },
      M: { neg: "Практичность", pos: "Мечтательность" },
      N: { neg: "Прямолинейность", pos: "Дипломатичность" },
      Q1: { neg: "Консерватизм", pos: "Гибкость" },
    };

    const tagToStyle: Record<string, string> = Object.fromEntries((result.ranked || []).map((r: any) => [r.tag, r.style]));

    const genderRu = meta.gender === "male" ? "мужчина" : meta.gender === "female" ? "женщина" : "—";
    const age = meta.age ?? "—";
    const normLabel = meta.normLabel || meta.norm_label_ru || meta.norm_group_label || meta.normGroupLabel || meta.norm_group || meta.normGroup || "—";

    const chipClass = (sten: number) => {
      if (sten >= 8) return "border-green-200 bg-green-50 text-green-800";
      if (sten <= 3) return "border-red-200 bg-red-50 text-red-800";
      return "border-zinc-200 bg-white/60 text-zinc-700";
    };

    return (
      <div className="grid gap-3">
        <div className="text-xs text-zinc-600">
          Нормы: <span className="font-medium text-zinc-800">{String(normLabel)}</span>
          <span className="mx-2 text-zinc-300">·</span>
          Пол: <span className="font-medium text-zinc-800">{genderRu}</span>
          <span className="mx-2 text-zinc-300">·</span>
          Возраст: <span className="font-medium text-zinc-800">{String(age)}</span>
        </div>

        <div className="grid gap-2">
          {result.ranked.map((r, idx) => {
            const sten = Number(stenByFactor?.[r.tag] ?? r.count ?? 0);
            const raw = rawByFactor?.[r.tag];
            const rawMax = maxRawByFactor?.[r.tag] ?? maxByFactor?.[r.tag];
            return (
              <div
                key={r.tag}
                className={[
                  "flex items-center justify-between gap-3 rounded-xl border px-3 py-2",
                  idx % 2 === 0 ? "bg-white/55" : "bg-white/35",
                ].join(" ")}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.style}</div>
                  <div className="mt-0.5 text-xs text-zinc-600">
                    Сырые: {raw ?? "?"}/{rawMax ?? "?"}
                  </div>
                </div>
                <div className={["shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold", chipClass(sten)].join(" ")}>STEN {sten}/10</div>
              </div>
            );
          })}
        </div>

        {secondary && Object.keys(secondary).length > 0 ? (
          <div className="grid gap-2 rounded-2xl border bg-white/35 p-3">
            <div className="text-xs font-semibold text-zinc-800">Вторичные факторы</div>
            <div className="grid gap-2">
              {Object.entries(secondary).sort(([a],[b]) => String(a).localeCompare(String(b))).map(([code, v]: any) => {
                const stenRaw = Number(v?.count ?? v?.sten ?? v?.value ?? 0);
                const sten = Number.isFinite(stenRaw) ? Math.max(1, Math.min(10, Math.round(stenRaw))) : 0;
                const sign = (v?.sign as string) || (sten >= 6 ? "+" : "-");
                const name = secondaryNames[code] || v?.name;
                return (
                  <div key={code} className="flex items-center justify-between gap-3 rounded-xl border bg-white/55 px-3 py-2">
                    <div className="min-w-0 text-sm font-medium">
                      {String(code)}{sign}
                      {name ? <span className="ml-2 text-xs font-normal text-zinc-600">— {name}</span> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={["rounded-lg border px-2 py-1 text-xs font-semibold", chipClass(sten)].join(" ")}>STEN {sten}/10</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setShowTabidze((v) => !v)}
            className="rounded-xl border bg-white/60 px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-white"
          >
            {showTabidze ? "Скрыть таблицу по Табидзе" : "Показать таблицу по Табидзе"}
          </button>
        </div>

        {showTabidze ? (
          <div className="grid gap-3 rounded-2xl border bg-white/35 p-3">
            <div className="text-xs font-semibold text-zinc-800">Таблица по Табидзе</div>

            {tabidzeGroups.map((g) => (
              <div key={g.title} className="grid gap-2">
                <div className="text-[11px] font-semibold text-zinc-700">{g.title}</div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-[11px]">
                    <thead>
                      <tr className="text-zinc-600">
                        <th className="border px-2 py-1 text-left">STEN</th>
                        <th className="border px-2 py-1 text-left">Фактор</th>
                        <th className="border px-2 py-1 text-left">Ф*</th>
                        <th className="border px-2 py-1 text-left">Ф^</th>
                        <th className="border px-2 py-1 text-left">Полюс отрицательный</th>
                        <th className="border px-2 py-1 text-center">Шкала (−5…+5)</th>
                        <th className="border px-2 py-1 text-left">Полюс положительный</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.factors.map((tag) => {
                        const sten = Number(stenByFactor?.[tag] ?? 0);
                        const star = invertSet.has(tag) ? 10 - sten : sten;
                        const hat = star - 5;
                        const neg = poles[tag]?.neg ?? "";
                        const pos = poles[tag]?.pos ?? "";
                        const style = tagToStyle[tag] || tag;
                        const pct = Math.min(5, Math.abs(hat)) / 5;
                        const w = `${Math.round(pct * 100)}%`;

                        return (
                          <tr key={tag} className="text-zinc-800">
                            <td className="border px-2 py-1">{sten}</td>
                            <td className="border px-2 py-1">{style}</td>
                            <td className="border px-2 py-1">{invertSet.has(tag) ? `${star}*` : star}</td>
                            <td className="border px-2 py-1">{hat}</td>
                            <td className="border px-2 py-1">{neg}</td>
                            <td className="border px-2 py-1">
                              <div className="relative mx-auto h-3 w-56 rounded bg-zinc-100">
                                <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-400" />
                                {hat < 0 ? (
                                  <div className="absolute inset-y-0 right-1/2 bg-zinc-900" style={{ width: w }} />
                                ) : hat > 0 ? (
                                  <div className="absolute inset-y-0 left-1/2 border border-zinc-900 bg-white" style={{ width: w }} />
                                ) : null}
                              </div>
                            </td>
                            <td className="border px-2 py-1">{pos}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : null}

      </div>
    );
  }

  if (kind === "situational_guidance_v1") {
    const total = result.total || 12;
    const meta: any = (result.meta as any) || {};
    const flex = Number(meta?.flexibility?.sum ?? (result.counts as any)?.flexibility ?? 0);
    const flexLevel = String(meta?.flexibility?.level ?? "");
    const flexNorm = meta?.flexibility?.norm || { normal_min: 19, normal_max: 22 };

    const adeq: any = meta?.adequacy || {};
    const diag = Number(adeq?.diagonal ?? (result.counts as any)?.diagonal ?? 0);
    const near = Number(adeq?.near ?? (result.counts as any)?.near ?? 0);
    const upper = Number(adeq?.upper ?? (result.counts as any)?.upper ?? 0);
    const lower = Number(adeq?.lower ?? (result.counts as any)?.lower ?? 0);
    const diagOrders = (adeq?.diagonal_orders || []) as number[];
    const nearOrders = (adeq?.near_orders || []) as number[];
    const upperOrders = (adeq?.upper_orders || []) as number[];
    const lowerOrders = (adeq?.lower_orders || []) as number[];

    const diagPct = Number(adeq?.diagonal_percent ?? ((diag / (total || 1)) * 100).toFixed(1));
    const nearPct = Number(adeq?.near_percent ?? ((near / (total || 1)) * 100).toFixed(1));
    const upperPct = Number(adeq?.upper_percent ?? ((upper / (total || 1)) * 100).toFixed(1));
    const lowerPct = Number(adeq?.lower_percent ?? ((lower / (total || 1)) * 100).toFixed(1));

    return (
      <div className="grid gap-3">
        <div className="grid gap-2">
          {result.ranked.map((r, idx) => (
            <div
              key={r.tag}
              className={[
                "flex items-center justify-between rounded-xl border px-3 py-2",
                idx % 2 === 0 ? "bg-white/55" : "bg-white/35",
              ].join(" ")}
            >
              <div className="text-sm font-medium">
                <span className="mr-2 inline-flex h-5 w-8 items-center justify-center rounded-md border bg-white text-[11px] text-zinc-700">
                  {String(r.tag)}
                </span>
                {r.style}
              </div>
              <div className="text-sm text-zinc-700">
                {r.count}/{total}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border bg-white/55 p-3 text-sm">
          <div className="font-medium text-zinc-900">Гибкость применения стилей</div>
          <div className="mt-1 text-zinc-700">
            <b>{flex}</b> баллов{" "}
            <span className="text-xs text-zinc-500">
              ({flexLevel || "—"}, норма {flexNorm?.normal_min ?? 19}–{flexNorm?.normal_max ?? 22})
            </span>
          </div>
        </div>

        <div className="rounded-2xl border bg-white/55 p-3 text-sm">
          <div className="font-medium text-zinc-900">Адекватность применения стилей</div>
          <div className="mt-1 text-zinc-700">
            <b>{diagPct}%</b>{" "}
            <span className="text-xs text-zinc-500">
              ({diag}/{total} на диагонали)
            </span>
          </div>

          <div className="mt-3 text-sm text-zinc-700">
            <div className="font-medium text-zinc-900">Прямо противоположный стиль</div>
            <div className="mt-1">Попустительский: <b>{upperPct}%</b> <span className="text-xs text-zinc-500">({upper}/{total})</span></div>
            {upperOrders?.length ? (
              <div className="mt-0.5 text-xs text-zinc-500">Ситуации: {upperOrders.join(", ")}</div>
            ) : null}
            <div className="mt-1">Излишний контроль: <b>{lowerPct}%</b> <span className="text-xs text-zinc-500">({lower}/{total})</span></div>
            {lowerOrders?.length ? (
              <div className="mt-0.5 text-xs text-zinc-500">Ситуации: {lowerOrders.join(", ")}</div>
            ) : null}
            {near ? (
              <div className="mt-2 text-xs text-zinc-500">Рядом с диагональю: {nearPct}% ({near}/{total})</div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }



  if (kind === "belbin_v1") {
    const total = (result as any).total || 70;
    const top = [...(result.ranked || [])]
      .sort((a: any, b: any) => Number(b?.count ?? 0) - Number(a?.count ?? 0))
      .slice(0, 3);

    return (
      <div className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-3">
          {top.map((r: any, i: number) => (
            <div key={String(r.tag)} className="rounded-2xl border bg-white/55 p-3">
              <div className="text-[11px] font-semibold text-zinc-600">Топ {i + 1}</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">{r.style}</div>
              <div className="mt-1 text-xs text-zinc-600">
                {r.count}/{total} · {r.percent}%
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-2">
          {result.ranked.map((r, idx) => (
            <div
              key={r.tag}
              className={[
                "flex items-center justify-between rounded-xl border px-3 py-2",
                idx % 2 === 0 ? "bg-white/55" : "bg-white/35",
              ].join(" ")}
            >
              <div className="text-sm font-medium">
                <span className="mr-2 inline-flex h-5 min-w-10 items-center justify-center rounded-md border bg-white px-2 text-[11px] text-zinc-700">
                  {String(r.tag)}
                </span>
                {r.style}
              </div>
              <div className="text-sm text-zinc-700">
                {r.count}/{total} · {r.percent}%
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs text-zinc-500">
          Примечание: роль «Специалист» в этой версии опросника может не измеряться отдельной шкалой.
        </div>
      </div>
    );
  }

  if (kind === "forced_pair_v1") {
    const total = result.total || 0;
    return (
      <div className="grid gap-2">
        {result.ranked.map((r, idx) => (
          <div
            key={r.tag}
            className={[
              "flex items-center justify-between rounded-xl border px-3 py-2",
              idx % 2 === 0 ? "bg-white/55" : "bg-white/35",
            ].join(" ")}
          >
            <div className="text-sm font-medium">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-md border bg-white text-[11px] text-zinc-700">
                {String(r.tag)}
              </span>
              {r.style}
            </div>
            <div className="text-sm text-zinc-700">
              {r.count}/{total} · {r.level}
            </div>
          </div>
        ))}
      </div>
    );
  }
  const maxByFactor = (result.meta as any)?.maxByFactor || {};
  return (
    <div className="grid gap-2">
      {result.ranked.map((r, idx) => (
        <div
          key={r.tag}
          className={[
            "flex items-center justify-between rounded-xl border px-3 py-2",
            idx % 2 === 0 ? "bg-white/55" : "bg-white/35",
          ].join(" ")}
        >
          <div>
            {kind === "pair_sum5_v1" ? (
              <>
                <div className="text-sm font-medium">Фактор "{r.tag}"</div>
                <div className="mt-0.5 text-xs text-zinc-600">{r.style}</div>
              </>
            ) : (
              <div className="text-sm font-medium">
                <span className="mr-2 inline-flex min-w-10 items-center justify-center rounded-md border bg-white px-2 py-0.5 text-[11px] text-zinc-700">
                  {String(r.tag)}
                </span>
                {r.style}
              </div>
            )}
          </div>
          <div className="text-sm text-zinc-700">
            {r.count}/{maxByFactor[r.tag] ?? "?"} · {r.level}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SpecialistRoom({ tests }: Props) {
  const router = useRouter();
  const roomId = String(router.query.roomId || "");
  const { session, user } = useSession();

  const [members, setMembers] = useState<Member[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [roomTests, setRoomTests] = useState<any[]>([]);
  const [roomTestsDraft, setRoomTestsDraft] = useState<any[]>([]);
  const [savingRoomTests, setSavingRoomTests] = useState(false);
  const [roomTestsMsg, setRoomTestsMsg] = useState<string>("");
  const [cells, setCells] = useState<Record<string, any>>({});
  const [roomName, setRoomName] = useState<string>("Комната");
  const [editRoomName, setEditRoomName] = useState<string>("");
  const [savingRoom, setSavingRoom] = useState(false);
  const [roomMsg, setRoomMsg] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // modal
  const [open, setOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [attempt, setAttempt] = useState<any>(null);
  const [interp, setInterp] = useState<string>("");
  const [busyInterp, setBusyInterp] = useState(false);
  const [clientText, setClientText] = useState<string>("");
  const [busySendClient, setBusySendClient] = useState(false);
  const [clientMsg, setClientMsg] = useState<string>("");
  const [copyMsg, setCopyMsg] = useState<string>("");
  const [copied, setCopied] = useState<string>("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shared, setShared] = useState(false);
  const [shareMsg, setShareMsg] = useState<string>("");
  const [shareRevealResults, setShareRevealResults] = useState(false);

  const [shareRoomBusy, setShareRoomBusy] = useState(false);
  const [shareRoomMsg, setShareRoomMsg] = useState<string>("");

  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string>("");

  const [copyBusy, setCopyBusy] = useState(false);
  const [copyMsg2, setCopyMsg2] = useState<string>("");

  const load = async () => {
    if (!session || !roomId) return;
    setLoading(true);
    setErr("");
    try {
      const dashRes = await fetch(`/api/training/rooms/dashboard?room_id=${encodeURIComponent(roomId)}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const dashJson = await dashRes.json();
      if (!dashRes.ok || !dashJson?.ok) throw new Error(dashJson?.error || "Не удалось загрузить комнату");

      const name = dashJson.room?.name || "Комната";
      setRoomName(name);
      setEditRoomName((prev) => (prev ? prev : name));
      setRoomMsg("");

      setMembers(dashJson.members || []);
      setProgress(dashJson.progress || []);
      setRoomTests(dashJson.room_tests || []);
      setRoomTestsDraft(dashJson.room_tests || []);
      setCells(dashJson.cells || {});
      setRoomTestsMsg("");
    } catch (e: any) {
      setErr(e?.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!session || !roomId) return;
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, roomId]);

  const byUserTest = useMemo(() => {
    const m = new Map<string, Progress>();
    for (const p of progress) {
      m.set(`${p.user_id}:${p.test_slug}`, p);
    }
    return m;
  }, [progress]);

  const testsBySlug = useMemo(() => {
    const m = new Map<string, AnyTest>();
    for (const t of tests) m.set(t.slug, t);
    return m;
  }, [tests]);

  const orderedRoomTests = useMemo(() => {
    const base = Array.isArray(roomTests) && roomTests.length ? roomTests : tests.map((t, i) => ({ test_slug: t.slug, is_enabled: true, sort_order: i }));
    return [...base].sort((a: any, b: any) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  }, [roomTests, tests]);

  const enabledTests = useMemo(() => {
    return orderedRoomTests
      .filter((r: any) => !!r.is_enabled)
      .map((r: any) => testsBySlug.get(String(r.test_slug)))
      .filter(Boolean) as AnyTest[];
  }, [orderedRoomTests, testsBySlug]);

  const participants = useMemo(() => {
    const selfId = user?.id;
    return members.filter((m) => m.role === "participant" || (selfId && m.user_id === selfId));
  }, [members, user?.id]);

  const attemptTest = useMemo(() => {
    const slug = String(attempt?.test_slug || "").trim();
    if (!slug) return null;
    return tests.find((t) => t.slug === slug) || null;
  }, [attempt?.test_slug, tests]);

  const answersView = useMemo(() => {
    if (!attempt || !attemptTest) return [] as { title: string; answer: string }[];

    const safeText = (v: any) => String(v ?? "").trim();

    // forced_pair (переговорный стиль)
    if (attemptTest.type === "forced_pair" || attemptTest.type === "forced_pair_v1") {
      const chosen: string[] = Array.isArray(attempt?.answers?.chosen) ? attempt.answers.chosen : [];
      return attemptTest.questions.map((q: any, idx: number) => {
        const tag = safeText(chosen[idx]);
        const optA = (q?.left ?? q?.options?.[0]) as any;
        const optB = (q?.right ?? q?.options?.[1]) as any;
        const aText = safeText(optA?.text ?? optA?.label);
        const bText = safeText(optB?.text ?? optB?.label);

        let pickedSide: "A" | "B" | "" = "";
        if (tag) {
          if (optA?.tag && String(optA.tag) === tag) pickedSide = "A";
          else if (optB?.tag && String(optB.tag) === tag) pickedSide = "B";
          else if (tag === "left" || tag === "A" || tag === "a") pickedSide = "A";
          else if (tag === "right" || tag === "B" || tag === "b") pickedSide = "B";
        }

        const question = safeText(q?.prompt || q?.statement || `Вопрос ${idx + 1}`);
        const chosenText = pickedSide === "A" ? aText : pickedSide === "B" ? bText : "";
        const answer = pickedSide
          ? `Выбран вариант: ${pickedSide === "A" ? "1" : "2"}

${pickedSide === "A" ? "✅ " : ""}Вариант 1: ${aText || "—"}
${pickedSide === "B" ? "✅ " : ""}Вариант 2: ${bText || "—"}`
          : `Вариант 1: ${aText || "—"}
Вариант 2: ${bText || "—"}

Выбран вариант: —`;

        return { title: `${idx + 1}. ${question}`, answer };
      });
    }

    // color_types_v1 (Цветотипы)
    if (attemptTest.type === "color_types_v1") {
      const a = (attempt?.answers as any)?.color || {};
      const byOrder = new Map<number, any>();
      for (const q of (attemptTest.questions || []) as any[]) byOrder.set(Number(q.order), q);

      const prompt = (o: number) => safeText(byOrder.get(o)?.prompt || `Вопрос ${o}`);
      const optABC = (o: number, k: any) => safeText(byOrder.get(o)?.options?.[String(k)]);
      const optNum = (o: number, k: number) => safeText(byOrder.get(o)?.options?.[String(k)]);

      const q1 = safeText(a.q1);
      const q2 = safeText(a.q2);
      const q3 = Array.isArray(a.q3) ? a.q3.map((x: any) => safeText(x)).filter(Boolean) : [];
      const q4 = Array.isArray(a.q4) ? a.q4.map((x: any) => safeText(x)).filter(Boolean) : [];
      const q5 = Array.isArray(a.q5) ? a.q5.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n)) : [];
      const q6 = Array.isArray(a.q6) ? a.q6.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n)) : [];

      const rankBlock = (o: number, arr: string[]) => {
        const parts = arr.slice(0, 3);
        const lines = [`Порядок: ${parts.join(" → ") || "—"}`];
        for (const k of parts) {
          const t = optABC(o, k);
          if (t) lines.push(`${k} — ${t}`);
        }
        return lines.join("\n");
      };
      const pickBlock = (o: number, arr: number[]) => {
        const parts = arr.slice(0, 3).slice().sort((x, y) => x - y);
        const lines = [`Выбор: ${parts.join(", ") || "—"}`];
        for (const n of parts) {
          const t = optNum(o, n);
          if (t) lines.push(`${n} — ${t}`);
        }
        return lines.join("\n");
      };

      return [
        {
          title: `1. ${prompt(1)}`,
          answer: q1 ? `Выбор: ${q1}${optABC(1, q1) ? ` — ${optABC(1, q1)}` : ""}` : "Выбор: —",
        },
        {
          title: `2. ${prompt(2)}`,
          answer: q2 ? `Выбор: ${q2}${optABC(2, q2) ? ` — ${optABC(2, q2)}` : ""}` : "Выбор: —",
        },
        { title: `3. ${prompt(3)}`, answer: rankBlock(3, q3) },
        { title: `4. ${prompt(4)}`, answer: rankBlock(4, q4) },
        { title: `5. ${prompt(5)}`, answer: pickBlock(5, q5) },
        { title: `6. ${prompt(6)}`, answer: pickBlock(6, q6) },
      ];
    }


    // situational_guidance_v1 (Ситуативное руководство)
    if (attemptTest.type === "situational_guidance_v1") {
      const chosen: string[] = Array.isArray((attempt as any)?.answers?.chosen) ? (attempt as any).answers.chosen : [];
      return (attemptTest.questions || []).map((q: any, i: number) => {
        const ch = safeText(chosen[i] ?? "").toUpperCase();
        const opts = (q?.options || {}) as Record<string, string>;
        const optText = ch && opts ? safeText(opts[ch]) : "";
        const question = safeText(q?.prompt || `Ситуация ${i + 1}`);
        const answer = ch
          ? `Выбран вариант: ${ch}${optText ? `\n\n${ch}) ${optText}` : ""}`
          : "Выбран вариант: —";
        return { title: `${i + 1}. ${question}`, answer };
      });
    }


    // emin_v1 (ЭМИН, Д.В. Люсин) — 46 утверждений, ответы 0..3
    if (attemptTest.type === "emin_v1") {
      const arr: any[] = Array.isArray((attempt as any)?.answers?.emin)
        ? (attempt as any).answers.emin
        : Array.isArray((attempt as any)?.answers)
          ? ((attempt as any).answers as any[])
          : [];
      const labels = ["Совсем не согласен", "Скорее не согласен", "Скорее согласен", "Полностью согласен"];
      return (attemptTest.questions || []).map((q: any, i: number) => {
        const v = Number(arr[i]);
        const idx = Number.isFinite(v) ? Math.max(0, Math.min(3, Math.round(v))) : null;
        const answer = idx === null ? "Ответ: —" : `Ответ: ${idx} — ${labels[idx]}`;
        return { title: `${i + 1}. ${safeText(q?.text || "")}`, answer };
      });
    }

    // time_management_v1 (Тайм-менеджмент) — один выбор из 3 вариантов (L/P/C)
    if (attemptTest.type === "time_management_v1") {
      const arr: any[] = Array.isArray((attempt as any)?.answers?.chosen)
        ? (attempt as any).answers.chosen
        : Array.isArray((attempt as any)?.answers)
          ? ((attempt as any).answers as any[])
          : [];
      return (attemptTest.questions || []).map((q: any, i: number) => {
        const chosen = String(arr[i] || "").toUpperCase();
        const options = Array.isArray(q?.options) ? q.options : [];
        const picked = options.find((o: any) => String(o?.tag || "").toUpperCase() === chosen);
        const answer = chosen && picked
          ? `Выбран вариант: ${chosen}

${String(picked?.text || "")}`
          : "Выбран вариант: —";
        return { title: `${i + 1}. ${safeText(q?.text || "")}`, answer };
      });
    }


    // learning_typology_v1 (Типология личности обучения) — выбор A/B/C/D
    if (attemptTest.type === "learning_typology_v1") {
      const arr: any[] = Array.isArray((attempt as any)?.answers?.chosen)
        ? (attempt as any).answers.chosen
        : Array.isArray((attempt as any)?.answers)
          ? ((attempt as any).answers as any[])
          : [];
      return (attemptTest.questions || []).map((q: any, i: number) => {
        const chosen = String(arr[i] || "").toUpperCase();
        const options = Array.isArray(q?.options) ? q.options : [];
        const picked = options.find((o: any) => String(o?.code || "").toUpperCase() === chosen);
        const answer = chosen && picked
          ? `Выбран вариант: ${chosen}

${String(picked?.text || "")}`
          : "Выбран вариант: —";
        return { title: `${i + 1}. ${safeText(q?.text || "")}`, answer };
      });
    }
    if (attemptTest.type !== "pair_sum5_v1" && attemptTest.type !== "pair_split_v1") {
      return [] as { title: string; answer: string }[];
    }

    // pair_sum5 (мотивационные карты)
    const leftPoints: number[] = Array.isArray(attempt?.answers?.leftPoints) ? attempt.answers.leftPoints : [];

    const labelForAllocation = (strong: number, max: number) => {
      // Для max=5: 5=Однозначно, 4=Да с большей вероятностью, 3=Скорее да, чем нет
      return strong >= max ? "Однозначно" : strong >= max - 1 ? "Да, с большей вероятностью" : "Скорее да, чем нет";
    };

    return attemptTest.questions.map((q: any, idx: number) => {
      const max = Number(q?.maxPoints ?? 5);
      const v = typeof leftPoints[idx] === "number" ? leftPoints[idx] : null;
      const left = v === null ? null : Math.max(0, Math.min(max, Math.round(v)));
      const right = left === null ? null : Math.max(0, max - left);

      const lf = safeText(q?.left?.factor);
      const rf = safeText(q?.right?.factor);
      const aText = safeText(q?.left?.text);
      const bText = safeText(q?.right?.text);

      const title = `${idx + 1}. Пара${lf || rf ? ` (факторы ${lf || "—"} / ${rf || "—"})` : ""}`;

      if (left === null || right === null) {
        return {
          title,
          answer: `Утверждение 1${lf ? ` (фактор ${lf})` : ""}: ${aText || "—"}
Утверждение 2${rf ? ` (фактор ${rf})` : ""}: ${bText || "—"}

Выбран ответ: —`,
        };
      }

      const major = left > right ? 1 : 2;
      const strong = Math.max(left, right);
      const label = labelForAllocation(strong, max);

      const answer = `Выбран ответ: ${label} → ближе к утверждению ${major}

${major === 1 ? "✅ " : ""}Утверждение 1${lf ? ` (фактор ${lf})` : ""}: ${aText || "—"}
Баллы: ${left} из ${max}

${major === 2 ? "✅ " : ""}Утверждение 2${rf ? ` (фактор ${rf})` : ""}: ${bText || "—"}
Баллы: ${right} из ${max}`;

      return { title, answer };
    });
  }, [attempt, attemptTest]);

  const openAttempt = async (attemptId: string, displayName: string, testTitle: string) => {
    if (!session) return;
    if (!attemptId) return;
    setOpen(true);
    setModalTitle(`${displayName} · ${testTitle}`);
    setAttemptId(attemptId);
    setAttempt(null);
    setInterp("");
    setClientText("");
    setClientMsg("");
    setCopyMsg("");
    setShareMsg("");
    setShared(false);
    setShareRevealResults(false);
    try {
      const r = await fetch(`/api/training/attempts/get?attempt_id=${encodeURIComponent(attemptId)}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить попытку");
      setAttempt(j.attempt);
      const cached = (j.interpretations || []).find((x: any) => x.kind === "keys_ai")?.text || "";
      setInterp(cached);

      const finalText = (j.interpretations || []).find((x: any) => x.kind === "client_text")?.text || "";
      const draftText = (j.interpretations || []).find((x: any) => x.kind === "client_draft")?.text || "";
      setClientText(finalText || draftText || "");

      const sharedRow = (j.interpretations || []).find((x: any) => x.kind === "shared");
      const isShared = !!sharedRow;
      setShared(isShared);
      // shared row may contain JSON with visibility flags
      if (sharedRow?.text && typeof sharedRow.text === "string") {
        try {
          const meta = JSON.parse(sharedRow.text);
          setShareRevealResults(Boolean(meta?.reveal_results));
        } catch {
          setShareRevealResults(false);
        }
      }
    } catch (e: any) {
      setInterp(`Ошибка: ${e?.message || "Не удалось загрузить"}`);
    }
  };

  const shareToLK = async (revealOverride?: boolean) => {
    if (!session || !attemptId) return;
    setShareBusy(true);
    setShareMsg("");
    try {
      const r = await fetch("/api/training/attempts/share", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ attempt_id: attemptId, reveal_results: typeof revealOverride === "boolean" ? revealOverride : shareRevealResults }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось отправить");
      setShared(true);
      setShareMsg("Показано в ЛК ✅");
      setTimeout(() => setShareMsg(""), 2500);
    } catch (e: any) {
      setShareMsg(e?.message || "Ошибка");
    } finally {
      setShareBusy(false);
    }
  };

  const unshareFromLK = async () => {
    if (!session || !attemptId) return;
    setShareBusy(true);
    setShareMsg("");
    try {
      const r = await fetch("/api/training/attempts/unshare", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ attempt_id: attemptId }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось отозвать");
      setShared(false);
      setShareMsg("Отозвано ✅");
      setTimeout(() => setShareMsg(""), 2500);
    } catch (e: any) {
      setShareMsg(e?.message || "Ошибка");
    } finally {
      setShareBusy(false);
    }
  };

  const shareAllInRoom = async () => {
    if (!session || !roomId) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm("Отправить в ЛК все завершённые результаты участников этой комнаты?");
      if (!ok) return;
    }
    setShareRoomBusy(true);
    setShareRoomMsg("");
    try {
      const r = await fetch("/api/training/attempts/share-room", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: roomId }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось отправить");
      const added = typeof j.added === "number" ? j.added : 0;
      const total = typeof j.total === "number" ? j.total : 0;
      setShareRoomMsg(total ? `Отправлено: ${added}/${total} ✅` : "Нет завершённых результатов");
      setTimeout(() => setShareRoomMsg(""), 3500);
    } catch (e: any) {
      setShareRoomMsg(e?.message || "Ошибка");
    } finally {
      setShareRoomBusy(false);
    }
  };

  const generate = async () => {
    if (!session || !attemptId) return;
    setBusyInterp(true);
    try {
      const r = await fetch("/api/training/attempts/interpret-keys", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        // If there is already an interpretation shown, the user expects a fresh regeneration.
        body: JSON.stringify({ attempt_id: attemptId, force: Boolean(interp) }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось расшифровать");
      setInterp(String(j.staff_text || j.text || ""));
      setClientText((prev) => {
        // If specialist already typed something, don't overwrite silently on background calls.
        // But when user clicks "Сгенерировать/Пересчитать", we assume they want the fresh draft.
        return String(j.client_text || "");
      });
    } catch (e: any) {
      setInterp(`Ошибка: ${e?.message || "Не удалось расшифровать"}`);
    } finally {
      setBusyInterp(false);
    }
  };

  const saveRoomName = async () => {
    if (!session || !roomId) return;
    const name = editRoomName.trim();
    if (!name) {
      setRoomMsg("Название не может быть пустым");
      return;
    }
    setSavingRoom(true);
    setRoomMsg("");
    try {
      const r = await fetch("/api/training/rooms/update", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: roomId, name }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось сохранить");
      setRoomName(name);
      setRoomMsg("Сохранено ✅");
    } catch (e: any) {
      setRoomMsg(e?.message || "Ошибка сохранения");
    } finally {
      setSavingRoom(false);
    }
  };

  
  const normalizeRoomTestsDraft = (rows: any[]) => {
    const sorted = [...rows].sort((a: any, b: any) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
    return sorted.map((r: any, i: number) => ({ ...r, sort_order: i }));
  };

  const moveRoomTest = (slug: string, dir: -1 | 1) => {
    setRoomTestsDraft((prev) => {
      const rows = normalizeRoomTestsDraft(Array.isArray(prev) && prev.length ? prev : roomTests);
      const i = rows.findIndex((r: any) => String(r.test_slug) === slug);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= rows.length) return rows;
      const next = [...rows];
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      return next.map((r, idx) => ({ ...r, sort_order: idx }));
    });
  };

  const toggleRoomTest = (slug: string) => {
    setRoomTestsDraft((prev) => {
      const rows = normalizeRoomTestsDraft(Array.isArray(prev) && prev.length ? prev : roomTests);
      return rows.map((r: any) => (String(r.test_slug) === slug ? { ...r, is_enabled: !r.is_enabled } : r));
    });
  };

  const saveRoomTests = async () => {
    if (!session || !roomId) return;
    const rows = normalizeRoomTestsDraft(Array.isArray(roomTestsDraft) && roomTestsDraft.length ? roomTestsDraft : roomTests);
    setSavingRoomTests(true);
    setRoomTestsMsg("");
    try {
      const r = await fetch("/api/training/rooms/tests/set", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: roomId, room_tests: rows }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось сохранить");
      setRoomTests(j.room_tests || rows);
      setRoomTestsDraft(j.room_tests || rows);
      setRoomTestsMsg("Сохранено ✅");
      setTimeout(() => setRoomTestsMsg(""), 2500);
      // refresh dashboard cells (mini + sent flags)
      load();
    } catch (e: any) {
      setRoomTestsMsg(e?.message || "Ошибка");
    } finally {
      setSavingRoomTests(false);
    }
  };

  const copyParticipantLink = async () => {
    if (!attemptId || typeof window === "undefined") return;
    const url = `${window.location.origin}/training/results?attempt=${encodeURIComponent(attemptId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyMsg("Ссылка скопирована ✅");
      setTimeout(() => setCopyMsg(""), 2500);
    } catch {
      setCopyMsg(url);
    }
  };

  const copyClientText = async () => {
    if (typeof window === "undefined") return;
    const text = (clientText || "").trim();
    if (!text) {
      setClientMsg("Текст пустой");
      setTimeout(() => setClientMsg(""), 2500);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setClientMsg("Скопировано ✅");
      setTimeout(() => setClientMsg(""), 2500);
    } catch {
      setClientMsg(text);
    }
  };

  const sendClientText = async () => {
    if (!session || !attemptId) return;
    const text = (clientText || "").trim();
    if (!text) {
      setClientMsg("Текст пустой");
      setTimeout(() => setClientMsg(""), 2500);
      return;
    }
    setBusySendClient(true);
    setClientMsg("");
    try {
      const r = await fetch("/api/training/attempts/send-client-text", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ attempt_id: attemptId, text, reveal_results: shareRevealResults }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось отправить");
      setShared(true);
      setClientMsg("Отправлено клиенту ✅");
      setTimeout(() => setClientMsg(""), 2500);
      // refresh matrix
      load();
    } catch (e: any) {
      setClientMsg(e?.message || "Ошибка");
    } finally {
      setBusySendClient(false);
    }
  };

  const exportExcel = async () => {
    if (!session || !roomId) return;
    setExportBusy(true);
    setExportMsg("");
    try {
      const r = await fetch("/api/training/rooms/export-excel", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: roomId }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error || "Не удалось экспортировать");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (roomName || "room").replace(/[\\/:*?"<>|]+/g, " ").trim() || "room";
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      a.href = url;
      a.download = `${safe}-results-${y}-${m}-${dd}.xls`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportMsg("Файл скачан ✅");
      setTimeout(() => setExportMsg(""), 2500);
    } catch (e: any) {
      setExportMsg(e?.message || "Ошибка");
    } finally {
      setExportBusy(false);
    }
  };

  // Quick alternative: copy the visible matrix (status + mini) as TSV.
  // User can paste directly into Excel / Google Sheets.
  const copyMatrixToExcel = async () => {
    setCopyBusy(true);
    setCopyMsg2("");
    try {
      const rows = members.filter((m) => m.role === "participant");
      const cols = enabledTests;
      if (!cols.length) throw new Error("Нет активных тестов");

      const header = ["ФИО", ...cols.map((t) => String(t.title || t.slug))].join("\t");
      const lines: string[] = [header];

      for (const m of rows) {
        const row: string[] = [String(m.display_name || "")];
        for (const t of cols) {
          const key = `${m.user_id}:${t.slug}`;
          const c = (cells as any)?.[key];
          if (!c) {
            row.push("");
            continue;
          }
          const status = String(c.status || "");
          const mini = String(c.mini || "").trim();
          const v = status === "done" ? (mini || "Готово") : status === "started" ? "В процессе" : "";
          row.push(v);
        }
        lines.push(row.join("\t"));
      }

      const tsv = lines.join("\n");

      // Clipboard (with fallback)
      const canClipboard = typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;
      if (canClipboard) {
        await navigator.clipboard.writeText(tsv);
      } else {
        const ta = document.createElement("textarea");
        ta.value = tsv;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }

      setCopyMsg2("Скопировано ✅ Теперь вставьте в Excel (Ctrl+V).");
      setTimeout(() => setCopyMsg2(""), 3000);
    } catch (e: any) {
      setCopyMsg2(e?.message || "Ошибка");
    } finally {
      setCopyBusy(false);
    }
  };

  if (!session || !user) {
    return (
      <Layout title="Специалист">
        <div className="card text-sm text-zinc-700">
          Нужно войти.
          <div className="mt-3">
            <Link href={`/auth?next=${encodeURIComponent(`/specialist/rooms/${roomId}`)}`} className="btn btn-secondary btn-sm">
              Вход / регистрация
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isSpecialistUser(user)) {
    return (
      <Layout title="Специалист">
        <div className="card text-sm text-zinc-700">Нет доступа.</div>
      </Layout>
    );
  }

  return (
    <Layout title={roomName}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/specialist" className="text-sm font-medium text-zinc-900 underline">
          ← К комнатам
        </Link>
        <button onClick={load} disabled={loading} className="btn btn-secondary btn-sm">
          {loading ? "…" : "Обновить"}
        </button>
      </div>

      {err ? <div className="mb-3 card text-sm text-red-600">{err}</div> : null}

      <div className="mb-4 card">
        <div className="text-sm font-semibold">Настройки комнаты</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            value={editRoomName}
            onChange={(e) => setEditRoomName(e.target.value)}
            className="rounded-xl border bg-white px-3 py-2 text-sm"
            placeholder="Название комнаты"
          />
          <button
            onClick={saveRoomName}
            disabled={savingRoom || !editRoomName.trim()}
            className="btn btn-primary disabled:opacity-50"
          >
            {savingRoom ? "…" : "Сохранить"}
          </button>
        </div>
        {roomMsg ? <div className="mt-2 text-xs text-zinc-600">{roomMsg}</div> : null}

        <div className="mt-4 border-t pt-4">
          <div className="text-sm font-semibold">Результаты</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={shareAllInRoom}
              disabled={shareRoomBusy}
              className="btn btn-secondary disabled:opacity-50"
            >
              {shareRoomBusy ? "…" : "Отправить всем в ЛК"}
            </button>
            <button
              onClick={copyMatrixToExcel}
              disabled={copyBusy}
              className="btn btn-secondary disabled:opacity-50"
              title="Скопировать матрицу (статус + миниитог) в буфер обмена"
            >
              {copyBusy ? "…" : "Скопировать в Excel"}
            </button>
            <button
              onClick={exportExcel}
              disabled={exportBusy}
              className="btn btn-secondary disabled:opacity-50"
            >
              {exportBusy ? "…" : "Экспорт Excel"}
            </button>
            {shareRoomMsg ? <div className="text-xs text-zinc-600">{shareRoomMsg}</div> : null}
            {copyMsg2 ? <div className="text-xs text-zinc-600">{copyMsg2}</div> : null}
            {exportMsg ? <div className="text-xs text-zinc-600">{exportMsg}</div> : null}
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            Это отправит в личный кабинет участникам все завершённые результаты (если расшифровка ещё не готова — они увидят статус ожидания).
          </div>
        </div>
      </div>

      <div className="mb-4 card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Тесты комнаты</div>
            <div className="mt-1 text-xs text-zinc-600">Выберите, какие тесты доступны участникам этой комнаты, и порядок отображения.</div>
          </div>
          <button
            onClick={saveRoomTests}
            disabled={savingRoomTests}
            className="btn btn-primary disabled:opacity-50"
          >
            {savingRoomTests ? "…" : "Сохранить"}
          </button>
        </div>

        {roomTestsMsg ? <div className="mt-2 text-xs text-zinc-600">{roomTestsMsg}</div> : null}

        <div className="mt-3 overflow-auto">
          <div className="min-w-[700px] grid gap-2">
            {(normalizeRoomTestsDraft(Array.isArray(roomTestsDraft) && roomTestsDraft.length ? roomTestsDraft : roomTests) as any[])
              .filter((rt: any) => String(rt?.test_slug) !== "16pf-b")
              .map((rt: any, idx: number) => {
              const t = testsBySlug.get(String(rt.test_slug));
              const title = t?.title || String(rt.test_slug);
              return (
                <div key={String(rt.test_slug)} className="flex items-center justify-between gap-3 rounded-2xl border bg-white p-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={!!rt.is_enabled}
                      onChange={() => toggleRoomTest(String(rt.test_slug))}
                    />
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium">{title}</div>
                        {String(rt.test_slug) === "16pf-a" ? (
                          <Link
                            href="/certificates"
                            className="rounded-md border bg-white/55 px-2 py-0.5 text-[10px] font-semibold text-zinc-700 hover:bg-white/70"
                            title="Открыть документы"
                          >
                            Сертифицировано
                          </Link>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-zinc-500">{String(rt.test_slug)}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => moveRoomTest(String(rt.test_slug), -1)}
                      disabled={idx === 0}
                      className="rounded-lg border bg-white/55 px-2 py-1 text-xs font-medium hover:bg-white/70 disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveRoomTest(String(rt.test_slug), 1)}
                      disabled={idx === (roomTestsDraft?.length ? roomTestsDraft.length - 1 : roomTests.length - 1)}
                      className="rounded-lg border bg-white/55 px-2 py-1 text-xs font-medium hover:bg-white/70 disabled:opacity-40"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mb-4 card text-sm text-zinc-700">
        Участники (онлайн обновляется раз в ~10 сек). Нажмите на ✅ в таблице, чтобы открыть результаты в цифрах и сделать
        расшифровку по ключам.
      </div>

      <div className="rounded-2xl border bg-white p-2 overflow-auto">
        <table className="min-w-[900px] w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 border-b p-2 text-left">Участник</th>
              <th className="border-b p-2 text-left w-[90px]">Онлайн</th>
              {enabledTests.map((t) => (
                <th key={t.slug} className="border-b p-2 text-left">
                  {t.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {participants.map((m) => (
              <tr key={m.user_id} className="border-b last:border-b-0">
                <td className="sticky left-0 bg-white z-10 p-2 font-medium">
                  <div className="flex items-center gap-2">
                    <span>{m.display_name}</span>
                    {m.role === "specialist" ? (
                      <span className="rounded-md border bg-white/55 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600">спец</span>
                    ) : null}
                  </div>
                </td>
                <td className="p-2">{m.online ? "🟢" : "⚪"}</td>
                {enabledTests.map((t) => {
                  const key = `${m.user_id}:${t.slug}`;
                  const p = byUserTest.get(key);
                  const cell = (cells as any)[key] as any;
                  const status = cell?.status || (p?.completed_at ? "done" : p?.started_at && !p?.completed_at ? "started" : "none");
                  const attemptId = cell?.attempt_id || p?.attempt_id;
                  const mini = cell?.mini || "";
                  const shared = !!cell?.shared;

                  return (
                    <td key={t.slug} className="p-2 align-top">
                      {status === "done" && attemptId ? (
                        <button
                          className="rounded-lg border bg-white/55 px-2 py-1 text-xs font-medium hover:bg-white/70"
                          onClick={() => openAttempt(String(attemptId), m.display_name, t.title)}
                        >
                          ✅
                        </button>
                      ) : status === "started" ? (
                        <span className="text-zinc-500">⏳</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}

                      {status === "done" && mini ? (
                        <div className="mt-1 text-[10px] leading-tight text-zinc-600">{mini}</div>
                      ) : null}

                      {status === "done" && shared ? (
                        <div className="mt-0.5 text-[10px] leading-tight text-emerald-700">📤 отправлено</div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
            {participants.length === 0 ? (
              <tr>
                <td colSpan={2 + enabledTests.length} className="p-4 text-center text-zinc-500">
                  Пока нет участников.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-3">
          <div className="mx-auto my-6 w-full max-w-2xl card shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{modalTitle}</div>
                <div className="mt-1 text-xs text-zinc-500">attempt: {attemptId}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyParticipantLink}
                  disabled={!attemptId}
                  className="btn btn-secondary btn-sm"
                >
                  Ссылка участнику
                </button>
                <button
                  onClick={() => (shared ? unshareFromLK() : shareToLK(shareRevealResults))}
                  disabled={!attemptId || shareBusy}
                  className={
                    "rounded-lg px-3 py-1.5 text-xs font-medium " +
                    (shared
                      ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                      : "border bg-white hover:bg-white/75")
                  }
                >
                  {shareBusy ? "…" : shared ? "Отозвать" : "Показать в ЛК"}
                </button>
                <button onClick={() => setOpen(false)} className="btn btn-secondary btn-sm">
                  Закрыть
                </button>
              </div>
            </div>

            {copyMsg ? <div className="mt-2 text-xs text-zinc-600">{copyMsg}</div> : null}
            {shareMsg ? <div className="mt-2 text-xs text-zinc-600">{shareMsg}</div> : null}

            <div className="mt-3 flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-700">
                <input
                  type="checkbox"
                  checked={shareRevealResults}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setShareRevealResults(next);
                    if (shared) shareToLK(next);
                  }}
                />
                Показывать клиенту результаты (цифры)
              </label>
            </div>

            <div className="mt-4">
              {attempt?.result ? (
                <Digits result={attempt.result as ScoreResult} />
              ) : (
                <div className="rounded-xl border bg-white/55 p-3 text-sm text-zinc-600">Загрузка…</div>
              )}
            </div>

            <div className="mt-4">
              <div className="text-sm font-medium">Ответы</div>
              <div className="mt-2 max-h-[30vh] overflow-auto rounded-2xl border bg-white p-3 text-sm">
                {answersView?.length ? (
                  <div className="grid gap-3">
                    {answersView.map((x: any, i: number) => (
                      <div key={i} className="rounded-xl border bg-white/55 p-3">
                        <div className="text-xs font-semibold text-zinc-600">{x.title}</div>
                        <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">{x.answer}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-zinc-500">Пока пусто.</div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div className="text-sm font-medium">Расшифровка по ключам</div>
              <button
                onClick={generate}
                disabled={busyInterp || !attempt?.result}
                className="btn btn-primary disabled:opacity-50"
              >
                {busyInterp ? "…" : interp ? "Пересчитать" : "Сгенерировать"}
              </button>
            </div>

            <div className="mt-3 max-h-[45vh] overflow-auto rounded-2xl border bg-white p-3 text-sm whitespace-pre-wrap">
              {interp ? interp : <span className="text-zinc-500">Пока пусто. Нажмите «Сгенерировать».</span>}
            </div>

            <div className="mt-5 flex items-center justify-between">
              <div className="text-sm font-medium">Текст для клиента</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyClientText}
                  disabled={!clientText.trim()}
                  className="btn btn-secondary btn-sm"
                >
                  Копировать
                </button>
                <button
                  onClick={sendClientText}
                  disabled={busySendClient || !clientText.trim() || !attemptId}
                  className="btn btn-primary btn-sm"
                >
                  {busySendClient ? "…" : "Отправить"}
                </button>
              </div>
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {shareRevealResults
                ? "Участник увидит этот текст и таблицу результатов (цифры). Можно редактировать и отправить частично."
                : "Участник увидит только этот текст (без цифр). Можно редактировать и отправить частично."}
            </div>
            <textarea
              value={clientText}
              onChange={(e) => setClientText(e.target.value)}
              placeholder="Сгенерируйте расшифровку по ключам и отредактируйте текст для клиента…"
              className="mt-2 textarea"
              rows={10}
            />
            {clientMsg ? <div className="mt-2 text-xs text-zinc-600">{clientMsg}</div> : null}
          </div>
        </div>
      ) : null}
    </Layout>
  );
}

export async function getServerSideProps() {
  const { getAllTests } = await import("@/lib/loadTests");
  const tests = await getAllTests();
  return { props: { tests } };
}
