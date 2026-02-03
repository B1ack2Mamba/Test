import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { LineChart } from "@/components/LineChart";
import { getTestBySlug } from "@/lib/loadTests";
import type { AnyTest } from "@/lib/testTypes";
import type { ScoreResult } from "@/lib/score";
import { useSession } from "@/lib/useSession";
import { useWalletBalance } from "@/lib/useWalletBalance";
import { getAttempt, updateAttempt } from "@/lib/localHistory";

function resultKey(slug: string) {
  return `attempt:${slug}:result`;
}
function authorKey(slug: string) {
  return `attempt:${slug}:author`;
}
function attemptIdKey(slug: string) {
  return `attempt:${slug}:id`;
}

const DETAILS_PRICE_RUB = 49;

function levelColor(level: string) {
  const l = level.toLowerCase();
  if (l.includes("выс")) return "bg-emerald-50 text-emerald-700";
  if (l.includes("сред")) return "bg-amber-50 text-amber-700";
  if (l.includes("низ")) return "bg-zinc-100 text-zinc-700";
  return "bg-zinc-100 text-zinc-700";
}

function normLevelKey(level: string): "low" | "medium" | "high" {
  const l = level.toLowerCase();
  if (l.includes("низ")) return "low";
  if (l.includes("сред")) return "medium";
  return "high";
}

function priceRub(test: AnyTest) {
  return test.pricing?.interpretation_rub ?? 0;
}

export default function TestResult({ test }: { test: AnyTest }) {
  const router = useRouter();
  const { user, session } = useSession();
  const { balance_rub, refresh } = useWalletBalance(user?.id || null);

  const [result, setResult] = useState<ScoreResult | null>(null);
  const [authorContent, setAuthorContent] = useState<any | null>(null);

  const [detailText, setDetailText] = useState<string>("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string>("");

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
    const rawAuthor = window.sessionStorage.getItem(authorKey(test.slug));
    if (rawAuthor) {
      try {
        setAuthorContent(JSON.parse(rawAuthor));
      } catch {
        setAuthorContent(null);
      }
    }

    // Фоллбек: если пользователь открыл результат из истории/после перезагрузки,
    // подхватываем данные конкретной попытки из localStorage.
    const attemptId = window.sessionStorage.getItem(attemptIdKey(test.slug));
    if (attemptId) {
      const userId = user?.id || "guest";
      const a = getAttempt(userId, test.slug, attemptId);
      if (a) {
        if (!raw) setResult(a.result);
        if (!rawAuthor && a.paid_author?.content) setAuthorContent(a.paid_author.content);
        if (!detailText && a.paid_detail?.text) setDetailText(a.paid_detail.text);
      }
    }
  }, [test.slug, user?.id]);

  const chartData = useMemo(() => {
    if (!result?.ranked?.length) return [];
    return result.ranked.map((r) => ({ tag: r.tag, percent: r.percent }));
  }, [result]);

  const p = useMemo(() => priceRub(test), [test]);

  const buyDetails = async () => {
    setDetailError("");

    if (!user || !session) {
      router.push(`/auth?next=${encodeURIComponent(`/tests/${test.slug}/result`)}`);
      return;
    }
    if (!result) {
      setDetailError("Сначала нужно показать результат.");
      return;
    }

    // Уже оплачено для этой попытки? Тогда просто показываем.
    if (typeof window !== "undefined") {
      const attemptId = window.sessionStorage.getItem(attemptIdKey(test.slug));
      if (attemptId) {
        const a = getAttempt(user.id, test.slug, attemptId);
        if (a?.paid_detail?.text) {
          setDetailText(a.paid_detail.text);
          return;
        }
      }
    }

    setDetailBusy(true);
    try {
      const opId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
      const resp = await fetch("/api/purchases/ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          op_id: opId,
          test_slug: test.slug,
          test_title: test.title,
          result,
        }),
      });
      const json = await resp.json();
      if (!resp.ok || !json?.ok) throw new Error(json?.error || "Ошибка оплаты");

      const text = String(json.text || "");
      setDetailText(text);

      // Кэшируем для конкретной попытки (повторный просмотр бесплатный)
      if (typeof window !== "undefined") {
        const attemptId = window.sessionStorage.getItem(attemptIdKey(test.slug));
        if (attemptId) {
          updateAttempt(user.id, test.slug, attemptId, { paid_detail: { at: Date.now(), text } });
        }
      }
      refresh();
    } catch (e: any) {
      setDetailError(e?.message ?? "Ошибка");
    } finally {
      setDetailBusy(false);
    }
  };

  const commentForRow = (row: { tag: string; level: string }) => {
    if (!authorContent) return "";

    // Motivation cards: authorContent.factors[code][low/medium/high]
    if (test.type === "pair_sum5_v1") {
      const key = normLevelKey(row.level);
      const f = authorContent?.factors?.[row.tag];
      const txt = f?.[key];
      return typeof txt === "string" ? txt : "";
    }

    // Negotiation test (older payloads): authorContent.details[tag].text[] or authorContent.details[tag].level_texts
    const det = authorContent?.details?.[row.tag];
    if (!det) return "";
    if (Array.isArray(det.text)) return det.text.join(" ");
    if (typeof det === "string") return det;
    return "";
  };

  const introText = useMemo(() => {
    if (!authorContent) return "";
    const t = authorContent?.intro;
    return typeof t === "string" ? t : "";
  }, [authorContent]);

  return (
    <Layout title={`${test.title} — результат`}>
      {!result ? (
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm text-zinc-900">Результат не найден.</div>
          <div className="mt-2 text-sm text-zinc-600">
            Обычно это бывает после обновления страницы (результат хранится временно). Открой результат заново из истории.
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/tests/${test.slug}`} className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-zinc-50">
              ← К тесту
            </Link>
            <Link href="/" className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-zinc-50">
              На главную
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-2xl border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm text-zinc-600">
                  Баланс: <b className="text-zinc-900">{balance_rub ?? 0} ₽</b>
                </div>
                {test.has_interpretation && p > 0 ? (
                  <div className="mt-1 text-xs text-zinc-600">
                    Первый показ результата этой попытки списывает <b className="text-zinc-900">{p} ₽</b>. Короткие комментарии появляются после оплаты.
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-zinc-600">Результат бесплатный.</div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Link href="/wallet" className="rounded-xl border bg-white px-3 py-2 text-sm hover:bg-zinc-50">
                  Кошелёк
                </Link>
                <button
                  onClick={buyDetails}
                  disabled={detailBusy}
                  className="rounded-xl bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {detailBusy ? "Обрабатываем…" : `Подробная расшифровка — ${DETAILS_PRICE_RUB} ₽`}
                </button>
              </div>
            </div>

            {detailError ? <div className="mt-3 text-sm text-red-600">{detailError}</div> : null}
            {introText ? <div className="mt-3 text-sm text-zinc-700">{introText}</div> : null}
          </div>

          {chartData.length ? (
            <div className="mb-4 rounded-2xl border bg-white p-4">
              <div className="mb-3 text-sm font-medium text-zinc-900">Профиль</div>
              <LineChart data={chartData} />
            </div>
          ) : null}

          <div className="rounded-2xl border bg-white p-4">
            <div className="mb-3 text-sm font-medium text-zinc-900">Таблица</div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium text-zinc-700">Фактор</th>
                    <th className="py-2 text-left font-medium text-zinc-700">Процент</th>
                    <th className="py-2 text-left font-medium text-zinc-700">Уровень</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ranked.map((r) => {
                    const comment = commentForRow(r);
                    const denom = (() => {
                      if (result.kind === "forced_pair_v1") return result.total;
                      if (result.kind === "color_types_v1") return result.total;
                      if (result.kind === "pair_sum5_v1") {
                        const m = (result as any).meta?.maxByFactor;
                        const d = m?.[r.tag];
                        return Number.isFinite(d) ? Number(d) : null;
                      }
                      if (result.kind === "usk_v1") return result.total || 10;
                      if (result.kind === "16pf_v1") return 10;
                      return null;
                    })();

                    const extraRaw = (() => {
                      if (result.kind === "usk_v1") return (result as any).meta?.raw?.[r.tag] ?? null;
                      if (result.kind === "16pf_v1") {
                        const raw = (result as any).meta?.rawByFactor?.[r.tag];
                        const max = (result as any).meta?.maxByFactor?.[r.tag];
                        if (Number.isFinite(raw) && Number.isFinite(max)) return `${raw}/${max}`;
                        if (Number.isFinite(raw)) return String(raw);
                      }
                      return null;
                    })();

                    return (
                      <tr key={r.tag} className="border-b align-top">
                        <td className="py-3 pr-4">
                          <div className="font-medium text-zinc-900">{r.style}</div>
                          {comment ? <div className="mt-1 text-xs text-zinc-600">{comment}</div> : null}
                        </td>
                        <td className="py-3 pr-4 text-zinc-900">
                          <div>
                            {r.percent}%{" "}
                            <span className="text-xs text-zinc-600">
                              ({typeof denom === "number" ? `${r.count}/${denom}` : String(r.count)})
                            </span>
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
              <Link href={`/tests/${test.slug}`} className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-zinc-50">
                ← К тесту
              </Link>
              <Link href="/" className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-zinc-50">
                На главную
              </Link>
            </div>
          </div>

          {detailText ? (
            <div className="mt-4 rounded-2xl border bg-white p-4">
              <div className="mb-2 text-sm font-medium text-zinc-900">Подробная расшифровка</div>
              <div className="prose max-w-none whitespace-pre-wrap text-sm text-zinc-800">{detailText}</div>
            </div>
          ) : null}
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
