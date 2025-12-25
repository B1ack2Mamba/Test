import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { ForcedPairTestV1, Tag } from "@/lib/testTypes";
import type { ScoreResult } from "@/lib/score";
import { LineChart } from "@/components/LineChart";
import { useSession } from "@/lib/useSession";
import { formatRub, useWallet } from "@/lib/useWallet";

function resultKey(slug: string) {
  return `attempt:${slug}:result`;
}
function authorKey(slug: string) {
  return `attempt:${slug}:author`;
}

const SHOW_RESULT_PRICE_RUB = 99; // списание на кнопке "Показать результат"
const AI_PRICE_RUB = 49; // подробная расшифровка

export default function ResultPage({ test }: { test: ForcedPairTestV1 }) {
  const [result, setResult] = useState<ScoreResult | null>(null);
  const { session, user } = useSession();
  const { wallet, refresh: refreshWallet } = useWallet();

  const [authorContent, setAuthorContent] = useState<any | null>(null);
  const [authorError, setAuthorError] = useState<string>("");
  const [authorBusy, setAuthorBusy] = useState(false);

  const [aiText, setAiText] = useState<string>("");
  const [aiError, setAiError] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = window.sessionStorage.getItem(resultKey(test.slug));
    if (!raw) return;
    try {
      setResult(JSON.parse(raw));
    } catch {
      setResult(null);
    }

    const rawAuthor = window.sessionStorage.getItem(authorKey(test.slug));
    if (rawAuthor) {
      try {
        setAuthorContent(JSON.parse(rawAuthor));
      } catch {
        setAuthorContent(null);
      }
    }
  }, [test.slug]);

  const chartData = useMemo(() => {
    if (!result) return [];
    return (Object.keys(result.percents) as Tag[]).map((tag) => ({ tag, percent: result.percents[tag] }));
  }, [result]);

  const renderText = (t: string) => {
    const parts = t
      .split(/\n\s*\n/g)
      .map((s) => s.trim())
      .filter(Boolean);
    return (
      <div className="grid gap-2">
        {parts.map((p, i) => (
          <p key={i} className="text-sm text-zinc-700">
            {p}
          </p>
        ))}
      </div>
    );
  };

  const getAuthorText = (tag: Tag, level: string) => {
    const block = authorContent?.styles?.[tag];
    if (!block) return null;
    if (level === "сильная склонность") return block.strong ?? null;
    if (level === "слабая склонность") return block.weak ?? null;
    // для "умеренной" и остальных уровней используем основной текст
    return block.strong ?? null;
  };

  if (!result) {
    return (
      <Layout title="Результат">
        <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-600">
          Результат не найден (скорее всего ты обновил страницу). Пройди тест заново.
        </div>
        <div className="mt-4 flex gap-2">
          <Link
            href={`/tests/${test.slug}/take`}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Пройти ещё раз
          </Link>
          <Link
            href={`/tests/${test.slug}`}
            className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            К описанию
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Результат">
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-zinc-600">
          Чем выше процент, тем чаще ты выбирал утверждения, относящиеся к этому стилю.
        </div>

        <div className="mt-4">
          <LineChart data={chartData} />
        </div>

        <div className="mt-4 grid gap-2">
          {result.ranked.map((r) => {
            const authorText = getAuthorText(r.tag, r.level);

            // Если авторская расшифровка загружена — прячем её прямо в строке результата.
            if (authorText) {
              return (
                <details key={r.tag} className="rounded-xl border bg-white">
                  <summary className="cursor-pointer list-none px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">
                          {r.style} ({r.tag})
                        </div>
                        <div className="text-xs text-zinc-600">{r.level}</div>
                      </div>
                      <div className="text-sm font-semibold">{r.percent}%</div>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">Нажми, чтобы открыть расшифровку</div>
                  </summary>
                  <div className="border-t px-3 py-3">{renderText(String(authorText))}</div>
                </details>
              );
            }

            // Иначе показываем просто строку без раскрытия (например, после обновления страницы).
            return (
              <div key={r.tag} className="flex items-center justify-between rounded-xl border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">
                    {r.style} ({r.tag})
                  </div>
                  <div className="text-xs text-zinc-600">{r.level}</div>
                </div>
                <div className="text-sm font-semibold">{r.percent}%</div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border bg-zinc-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-[220px]">
              <div className="text-sm font-medium">Расшифровка</div>
              <div className="text-xs text-zinc-600">
                Авторская — раскрой стиль в списке выше. Подробная — {AI_PRICE_RUB} ₽.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {user && wallet ? (
                <div className="text-xs text-zinc-600">
                  Баланс: <b>{formatRub(wallet.balance_kopeks)}</b>
                </div>
              ) : null}

              {!user || !session ? (
                <Link
                  href={`/auth?next=${encodeURIComponent(`/tests/${test.slug}/result`)}`}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Войти
                </Link>
              ) : (
                <>
                  <button
                    disabled={aiBusy}
                    onClick={async () => {
                      setAiBusy(true);
                      setAiError("");
                      try {
                        const opId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
                        const resp = await fetch("/api/purchases/ai", {
                          method: "POST",
                          headers: {
                            "content-type": "application/json",
                            authorization: `Bearer ${session.access_token}`,
                          },
                          body: JSON.stringify({ test_slug: test.slug, test_title: test.title, result, op_id: opId }),
                        });
                        const json = await resp.json();
                        if (!resp.ok || !json?.ok) throw new Error(json?.error || "Ошибка оплаты");
                        setAiText(String(json.text || ""));
                        await refreshWallet();
                      } catch (e: any) {
                        setAiError(e?.message ?? "Ошибка");
                      } finally {
                        setAiBusy(false);
                      }
                    }}
                    className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Подробная расшифровка — {AI_PRICE_RUB} ₽
                  </button>

                  {!authorContent ? (
                    <button
                      disabled={authorBusy}
                      onClick={async () => {
                        setAuthorBusy(true);
                        setAuthorError("");
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

                          setAuthorContent(json.content ?? null);
                          if (typeof window !== "undefined") {
                            window.sessionStorage.setItem(authorKey(test.slug), JSON.stringify(json.content ?? null));
                          }
                          await refreshWallet();
                        } catch (e: any) {
                          setAuthorError(e?.message ?? "Ошибка");
                        } finally {
                          setAuthorBusy(false);
                        }
                      }}
                      className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Авторская — {SHOW_RESULT_PRICE_RUB} ₽
                    </button>
                  ) : null}
                </>
              )}

              <Link
                href="/wallet"
                className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                Кошелёк
              </Link>
            </div>
          </div>

          {!authorContent ? (
            <div className="mt-2 text-xs text-zinc-600">
              Если обновил страницу и текст в строках не раскрывается — открой авторскую заново.
            </div>
          ) : null}

          {authorError ? <div className="mt-2 text-sm text-red-600">{authorError}</div> : null}
          {aiError ? <div className="mt-2 text-sm text-red-600">{aiError}</div> : null}

          {aiText ? <div className="mt-4 whitespace-pre-wrap text-sm text-zinc-700">{aiText}</div> : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/tests/${test.slug}/take`}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Пройти ещё раз
          </Link>
          <Link
            href="/"
            className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            В каталог
          </Link>
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
