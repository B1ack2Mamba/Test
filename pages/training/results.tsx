import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";
import { LineChart } from "@/components/LineChart";
import type { ScoreResult } from "@/lib/score";

function levelColor(level: string) {
  const l = String(level || "").toLowerCase();
  if (l.includes("выс")) return "bg-emerald-50 text-emerald-700";
  if (l.includes("сред")) return "bg-amber-50 text-amber-700";
  if (l.includes("низ")) return "bg-white/60 text-zinc-700";
  return "bg-white/60 text-zinc-700";
}

export default function TrainingResults() {
  const router = useRouter();
  const { session, user, loading: sessionLoading } = useSession();
  const attemptId = String((router.query.attempt || router.query.attempt_id || "") as string);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [meta, setMeta] = useState<any>(null);
  const [reveal, setReveal] = useState(false);
  const [result, setResult] = useState<ScoreResult | null>(null);

  useEffect(() => {
    if (!router.isReady) return;
    if (!attemptId) return;
    if (sessionLoading) return;
    if (!session) {
      router.replace(`/auth?next=${encodeURIComponent(router.asPath)}`);
      return;
    }
    (async () => {
      setLoading(true);
      setErr("");
      try {
        const r = await fetch(`/api/training/self/interpretation?attempt_id=${encodeURIComponent(attemptId)}`, {
          headers: { authorization: `Bearer ${session.access_token}` },
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить");
        setText(String(j.text || ""));
        setMeta(j.attempt || null);
        setReveal(Boolean(j.reveal_results));
        setResult((j.reveal_results ? (j.result as ScoreResult) : null) || null);
      } catch (e: any) {
        setErr(e?.message || "Ошибка");
      } finally {
        setLoading(false);
      }
    })();
  }, [router.isReady, attemptId, session, sessionLoading, router.asPath]);

  return (
    <Layout title="Результаты">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/training" className="text-sm font-medium text-zinc-900 underline">
          ← К тренингам
        </Link>
      </div>

      {!attemptId ? (
        <div className="card text-sm text-zinc-700">Нет attempt_id.</div>
      ) : null}

      {err ? <div className="mb-3 card text-sm text-red-600">{err}</div> : null}

      {attemptId ? (
        <div className="grid gap-4">
          {reveal && result ? (
            <div className="card">
              <div className="text-sm font-semibold">Ваши результаты</div>
              {meta ? <div className="mt-1 text-xs text-zinc-500">test: {meta.test_slug}</div> : null}

              {result?.ranked?.length ? (
                <div className="mt-3">
                  <LineChart data={result.ranked.map((r) => ({ tag: r.tag, percent: r.percent }))} />
                </div>
              ) : null}

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 text-left font-medium text-zinc-700">Фактор</th>
                      <th className="py-2 text-left font-medium text-zinc-700">Баллы</th>
                      {result.kind === "16pf_v1" ? null : (
                        <th className="py-2 text-left font-medium text-zinc-700">Уровень</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {result.ranked.map((r, idx) => {
                      const isNumericPrimary = result.kind === "usk_v1" || result.kind === "16pf_v1";
                      const denom = (() => {
                        if (result.kind === "forced_pair_v1") return (result as any).total;
                        if (result.kind === "color_types_v1") return (result as any).total;
                        if (result.kind === "pair_sum5_v1") {
                          const m = (result as any).meta?.maxByFactor;
                          const d = m?.[r.tag];
                          return Number.isFinite(d) ? Number(d) : null;
                        }
                        if (result.kind === "usk_v1") return (result as any).total || 10;
                        if (result.kind === "16pf_v1") return 10;
                        return null;
                      })();

                      const extraRaw = (() => {
                        // Для участников: в 16PF не показываем сырые баллы.
                        if (result.kind === "usk_v1") return (result as any).meta?.rawByScale?.[r.tag] ?? null;
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
                            ) : result.kind === "16pf_v1" ? (
                              <div className="font-medium text-zinc-900">{r.style}</div>
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
                          {result.kind === "16pf_v1" ? null : (
                            <td className="py-3">
                              <span className={["inline-flex rounded-full px-2 py-1 text-xs", levelColor(r.level)].join(" ")}>{r.level}</span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="card">
            <div className="text-sm font-semibold">Ваша расшифровка</div>
            {meta ? <div className="mt-1 text-xs text-zinc-500">test: {meta.test_slug}</div> : null}

            <div className="mt-3 rounded-2xl border bg-white p-3 text-sm whitespace-pre-wrap">
              {loading ? (
                <div className="text-zinc-500">Загрузка…</div>
              ) : text ? (
                text
              ) : (
                <div className="text-zinc-500">
                  Пока нет расшифровки. Она появится после того, как специалист подготовит текст и нажмёт «Отправить».
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {!user ? <div className="mt-4 text-xs text-zinc-500">Нужен вход.</div> : null}
    </Layout>
  );
}
