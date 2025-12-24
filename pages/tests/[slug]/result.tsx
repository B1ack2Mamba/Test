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

export default function ResultPage({ test }: { test: ForcedPairTestV1 }) {
  const [result, setResult] = useState<ScoreResult | null>(null);
  const { supabase, user } = useSession();
  const { wallet, refresh: refreshWallet } = useWallet();
  const [unlocked, setUnlocked] = useState(false);
  const [interp, setInterp] = useState<any | null>(null);
  const [interpError, setInterpError] = useState<string>("");
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(resultKey(test.slug));
    if (!raw) return;
    try {
      setResult(JSON.parse(raw));
    } catch {
      setResult(null);
    }
  }, [test.slug]);

  const chartData = useMemo(() => {
    if (!result) return [];
    return (Object.keys(result.percents) as Tag[]).map((tag) => ({ tag, percent: result.percents[tag] }));
  }, [result]);

  const priceRub = test.pricing?.interpretation_rub ?? 0;
  const priceKopeks = Math.max(0, Math.floor(priceRub * 100));

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

  // Check unlock status + load interpretation (only for logged in users)
  useEffect(() => {
    if (!supabase || !user || !test.has_interpretation || priceKopeks <= 0) {
      setUnlocked(false);
      setInterp(null);
      setInterpError("");
      return;
    }

    let cancelled = false;
    (async () => {
      setInterpError("");
      const u = await supabase
        .from("test_unlocks")
        .select("test_slug")
        .eq("test_slug", test.slug)
        .maybeSingle();
      if (cancelled) return;
      const ok = !u.error && !!u.data;
      setUnlocked(ok);
      if (!ok) {
        setInterp(null);
        return;
      }

      const i = await supabase
        .from("test_interpretations")
        .select("content")
        .eq("test_slug", test.slug)
        .single();
      if (cancelled) return;
      if (i.error) {
        setInterp(null);
        setInterpError(i.error.message);
      } else {
        setInterp((i.data as any)?.content ?? null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, user?.id, test.slug, test.has_interpretation, priceKopeks]);

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
          {result.ranked.map((r) => (
            <div key={r.tag} className="flex items-center justify-between rounded-xl border px-3 py-2">
              <div>
                <div className="text-sm font-medium">
                  {r.style} ({r.tag})
                </div>
                <div className="text-xs text-zinc-600">{r.level}</div>
              </div>
              <div className="text-sm font-semibold">{r.percent}%</div>
            </div>
          ))}
        </div>

        {test.has_interpretation && priceKopeks > 0 ? (
          <div className="mt-6 rounded-2xl border bg-zinc-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">Расшифровка</div>
                <div className="text-xs text-zinc-600">
                  Открывается после оплаты. Цена: <b>{priceRub} ₽</b>.
                </div>
              </div>
              {user && wallet ? (
                <div className="text-xs text-zinc-600">
                  Баланс: <b>{formatRub(wallet.balance_kopeks)}</b>
                </div>
              ) : null}
            </div>

            {interpError ? <div className="mt-3 text-sm text-red-600">{interpError}</div> : null}

            {unlocked ? (
              <div className="mt-4 rounded-xl border bg-white p-4">
                {!interp ? (
                  <div className="text-sm text-zinc-600">Расшифровка загружается…</div>
                ) : (
                  <div className="grid gap-4">
                    {interp?.note ? (
                      <div className="rounded-xl border bg-zinc-50 p-3 text-sm text-zinc-700">
                        {interp.note}
                      </div>
                    ) : null}

                    <div className="grid gap-3">
                      {result.ranked.map((r) => {
                        const block = interp?.styles?.[r.tag];
                        if (!block) return null;
                        const text = r.level === "сильная склонность" ? block.strong : r.level === "слабая склонность" ? block.weak : block.strong;
                        return (
                          <div key={r.tag} className="rounded-xl border p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="text-sm font-medium">{r.style}</div>
                              <div className="text-xs text-zinc-600">{r.percent}% • {r.level}</div>
                            </div>
                            <div className="mt-2">{renderText(text)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {!user ? (
                  <Link
                    href={`/auth?next=${encodeURIComponent(`/tests/${test.slug}/result`)}`}
                    className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                  >
                    Войти для покупки
                  </Link>
                ) : (
                  <>
                    <button
                      disabled={unlocking}
                      onClick={async () => {
                        if (!supabase || !user) return;
                        setUnlocking(true);
                        setInterpError("");
                        try {
                          const { error } = await supabase.rpc("unlock_test", {
                            p_test_slug: test.slug,
                            p_price_kopeks: priceKopeks,
                          });
                          if (error) throw error;
                          setUnlocked(true);
                          await refreshWallet();

                          const i = await supabase
                            .from("test_interpretations")
                            .select("content")
                            .eq("test_slug", test.slug)
                            .single();
                          if (i.error) throw i.error;
                          setInterp((i.data as any)?.content ?? null);
                        } catch (e: any) {
                          setInterpError(e?.message ?? "Ошибка оплаты");
                        } finally {
                          setUnlocking(false);
                        }
                      }}
                      className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                    >
                      Открыть за {priceRub} ₽
                    </button>
                    <Link
                      href="/wallet"
                      className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                    >
                      Пополнить баланс
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        ) : null}

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
