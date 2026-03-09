import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { LineChart } from "@/components/LineChart";
import { getTestBySlug } from "@/lib/loadTests";
import type { AnyTest } from "@/lib/testTypes";
import type { ScoreResult } from "@/lib/score";
import { useSession } from "@/lib/useSession";
import { getAttempt } from "@/lib/localHistory";

function resultKey(slug: string) {
  return `attempt:${slug}:result`;
}

function attemptIdKey(slug: string) {
  return `attempt:${slug}:id`;
}

function levelColor(level: string) {
  const l = level.toLowerCase();
  if (l.includes("выс")) return "bg-emerald-50 text-emerald-700";
  if (l.includes("сред")) return "bg-amber-50 text-amber-700";
  if (l.includes("низ")) return "bg-slate-100 text-slate-700";
  return "bg-slate-100 text-slate-700";
}

export default function TestResult({ test }: { test: AnyTest }) {
  const { user } = useSession();
  const [result, setResult] = useState<ScoreResult | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = window.sessionStorage.getItem(resultKey(test.slug));
    if (raw) {
      try {
        setResult(JSON.parse(raw));
      } catch {
        setResult(null);
      }
    }

    // Fallback after reload: try to load attempt from localStorage
    const attemptId = window.sessionStorage.getItem(attemptIdKey(test.slug));
    if (attemptId) {
      const userId = user?.id || "guest";
      const a = getAttempt(userId, test.slug, attemptId);
      if (a && !raw) setResult(a.result);
    }
  }, [test.slug, user?.id]);

  const chartData = useMemo(() => {
    if (!result?.ranked?.length) return [];
    return result.ranked.map((r) => ({ tag: r.tag, percent: r.percent }));
  }, [result]);

  const isNumericPrimary = useMemo(() => {
    return result?.kind === "usk_v1" || result?.kind === "16pf_v1";
  }, [result?.kind]);

  const sgMeta = useMemo(() => {
    if (!result || result.kind !== "situational_guidance_v1") return null;
    const meta: any = (result.meta as any) || {};
    const total = result.total || 12;

    const flex = Number(meta?.flexibility?.sum ?? (result.counts as any)?.flexibility ?? 0);
    const flexLevel = String(meta?.flexibility?.level ?? "");
    const flexNorm = meta?.flexibility?.norm || { normal_min: 19, normal_max: 22 };

    const adeq: any = meta?.adequacy || {};
    const diag = Number(adeq?.diagonal ?? (result.counts as any)?.diagonal ?? 0);
    const near = Number(adeq?.near ?? (result.counts as any)?.near ?? 0);
    const upper = Number(adeq?.upper ?? (result.counts as any)?.upper ?? 0);
    const lower = Number(adeq?.lower ?? (result.counts as any)?.lower ?? 0);

    const diagPct = Number(adeq?.diagonal_percent ?? ((diag / (total || 1)) * 100).toFixed(1));
    const nearPct = Number(adeq?.near_percent ?? ((near / (total || 1)) * 100).toFixed(1));
    const upperPct = Number(adeq?.upper_percent ?? ((upper / (total || 1)) * 100).toFixed(1));
    const lowerPct = Number(adeq?.lower_percent ?? ((lower / (total || 1)) * 100).toFixed(1));

    return { total, flex, flexLevel, flexNorm, diag, near, upper, lower, diagPct, nearPct, upperPct, lowerPct };
  }, [result]);


  return (
    <Layout title={`${test.title} — результат`}>
      {!result ? (
        <div className="card">
          <div className="text-sm text-zinc-900">Результат не найден.</div>
          <div className="mt-2 text-sm text-zinc-600">Открой результат заново из истории.</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/tests/${test.slug}`} className="btn btn-secondary">
              ← К тесту
            </Link>
            <Link href="/training" className="btn btn-secondary">
              На главную
            </Link>
          </div>
        </div>
      ) : result.kind === "16pf_v1" ? (
        <div className="card">
          <div className="text-sm font-medium text-zinc-900">Тест завершён</div>
          <div className="mt-2 text-sm text-zinc-600">Результаты 16PF (сырые баллы, стэны и уровни) доступны только специалисту.</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/tests/${test.slug}`} className="btn btn-secondary">
              ← К тесту
            </Link>
            <Link href="/training" className="btn btn-secondary">
              На главную
            </Link>
          </div>
        </div>
      ) : (
        <>
          {chartData.length ? (
            <div className="mb-4 card">
              <div className="mb-3 text-sm font-medium text-zinc-900">Профиль</div>
              <LineChart data={chartData} />
            </div>
          ) : null}

          {sgMeta ? (
            <div className="mb-4 card">
              <div className="text-sm font-medium text-zinc-900">Итог</div>

              <div className="mt-3 grid gap-2 text-sm text-zinc-900">
                {result.ranked.map((r) => (
                  <div key={r.tag}>
                    {r.style} — <b>{r.count}</b> баллов
                  </div>
                ))}
              </div>

              <div className="mt-4 text-sm text-zinc-900">
                Твоя гибкость применения стилей — <b>{sgMeta.flex}</b> баллов{" "}
                <span className="text-xs text-zinc-500">
                  ({sgMeta.flexLevel || "—"}, норма {sgMeta.flexNorm?.normal_min ?? 19}–{sgMeta.flexNorm?.normal_max ?? 22})
                </span>
              </div>

              <div className="mt-3 text-sm text-zinc-900">
                Твоя адекватность применения стилей руководства — <b>{sgMeta.diagPct}%</b>
              </div>

              <div className="mt-3 text-sm text-zinc-900">
                Ситуации, в которых ты применяешь стиль руководства прямо противоположный от необходимого:
              </div>

              <div className="mt-2 text-sm text-zinc-900">
                Попустительский — <b>{sgMeta.upperPct}%</b>
              </div>
              <div className="mt-1 text-sm text-zinc-900">
                Излишне контролируешь — <b>{sgMeta.lowerPct}%</b>
              </div>

              {sgMeta.near ? (
                <div className="mt-2 text-xs text-zinc-500">
                  Рядом с диагональю: {sgMeta.nearPct}% ({sgMeta.near}/{sgMeta.total})
                </div>
              ) : null}

              <div className="mt-4 text-sm text-zinc-600">
                На очном тренинге с помощью тренера ты разберёшь свои результаты тестирования. Не забудь взять их с собой!
              </div>
            </div>
          ) : null}

          <div className="card">
            <div className="mb-3 text-sm font-medium text-zinc-900">Таблица</div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium text-zinc-700">Фактор</th>
                    <th className="py-2 text-left font-medium text-zinc-700">{isNumericPrimary ? "Баллы" : "Процент"}</th>
                    <th className="py-2 text-left font-medium text-zinc-700">Уровень</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ranked.map((r, idx) => {
                    const denom = (() => {
                      if (result.kind === "forced_pair_v1") return result.total;
                      if (result.kind === "color_types_v1") return result.total;
                      if (result.kind === "pair_sum5_v1") {
                        const m = (result as any).meta?.maxByFactor;
                        const d = m?.[r.tag];
                        return Number.isFinite(d) ? Number(d) : null;
                      }
                      if (result.kind === "usk_v1") return result.total || 10;
                      if (result.kind === "time_management_v1") return (result as any).total || 14;
                      if (result.kind === "learning_typology_v1") {
                        const d = (result as any).meta?.maxByFactor?.[r.tag];
                        return Number.isFinite(d) ? Number(d) : ((result as any).total || 20);
                      }
                      if (result.kind === "16pf_v1") return 10;
                      return null;
                    })();

                    const extraRaw = (() => {
                      if (result.kind === "usk_v1") return (result as any).meta?.rawByScale?.[r.tag] ?? null;
                      if (result.kind === "16pf_v1") {
                        const raw = (result as any).meta?.rawByFactor?.[r.tag];
                        const max = (result as any).meta?.maxByFactor?.[r.tag];
                        if (Number.isFinite(raw) && Number.isFinite(max)) return `${raw}/${max}`;
                        if (Number.isFinite(raw)) return String(raw);
                      }
                      return null;
                    })();

                    const stripe = idx % 2 === 0 ? "bg-white/55" : "bg-white/35";

                    return (
                      <tr key={r.tag} className={["border-b align-top", stripe].join(" ")}>
                        <td className="py-3 pr-4">
                          {result.kind === "pair_sum5_v1" ? (
                            <>
                              <div className="font-medium text-zinc-900">Фактор "{r.tag}"</div>
                              <div className="mt-0.5 text-xs text-zinc-600">{r.style}</div>
                            </>
                          ) : (
                            <div className="flex items-center gap-2 font-medium text-zinc-900">
                              <span className="inline-flex min-w-6 items-center justify-center rounded-md border bg-white px-1.5 py-0.5 text-[11px] text-zinc-700">
                                {String(r.tag)}
                              </span>
                              <span>{r.style}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-zinc-900">
                          <div>
                            {isNumericPrimary ? (
                              <>
                                <b>{r.count}</b>
                                <span className="text-xs text-zinc-600">/10</span>
                              </>
                            ) : (
                              <>
                                {r.percent}%{" "}
                                <span className="text-xs text-zinc-600">({typeof denom === "number" ? `${r.count}/${denom}` : String(r.count)})</span>
                              </>
                            )}
                          </div>
                          {extraRaw !== null && extraRaw !== undefined ? (
                            <div className="mt-1 text-[11px] text-zinc-500">Сырые баллы: {String(extraRaw)}</div>
                          ) : null}
                        </td>
                        <td className="py-3">
                          <span className={["inline-flex rounded-full px-2 py-1 text-xs", levelColor(r.level)].join(" ")}>{r.level}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/tests/${test.slug}`} className="btn btn-secondary">
                ← К тесту
              </Link>
              <Link href="/training" className="btn btn-secondary">
                На главную
              </Link>
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}

export async function getServerSideProps({ params }: { params: { slug: string } }) {
  const test = await getTestBySlug(params.slug);
  if (!test) return { notFound: true };
  return { props: { test } };
}
