import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";
import { formatRub, useWallet } from "@/lib/useWallet";
import Link from "next/link";
import { useMemo, useState } from "react";

type CreateTopupResp = {
  ok: boolean;
  confirmation_url?: string;
  payment_id?: string;
  error?: string;
};

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000];

export default function WalletPage() {
  const { user, session } = useSession();
  const { wallet, ledger, loading, error, refresh } = useWallet();

  const [topupOpen, setTopupOpen] = useState(false);
  const [amountRub, setAmountRub] = useState("500");
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupError, setTopupError] = useState<string | null>(null);

  const parsedRub = useMemo(() => {
    const n = Number(String(amountRub).replace(",", "."));
    if (!Number.isFinite(n)) return null;
    return Math.floor(n);
  }, [amountRub]);

  async function startTopup(rub: number) {
    if (!session?.access_token) {
      setTopupError("Нужно войти, чтобы пополнять баланс.");
      return;
    }

    setTopupBusy(true);
    setTopupError(null);
    try {
      const r = await fetch("/api/payments/yookassa/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ amount_rub: rub }),
      });

      const data = (await r.json()) as CreateTopupResp;
      if (!r.ok || !data.ok || !data.confirmation_url) {
        throw new Error(data.error || "Не удалось создать оплату");
      }

      // Redirect to YooKassa confirmation page (SBP QR / bank selection)
      window.location.href = data.confirmation_url;
    } catch (e: any) {
      setTopupError(e?.message || "Ошибка пополнения");
    } finally {
      setTopupBusy(false);
    }
  }

  return (
    <Layout title="Кошелёк">
      {!user ? (
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm text-zinc-700">
            Чтобы пользоваться кошельком — нужно войти.
          </div>
          <Link
            href="/auth?next=/wallet"
            className="mt-3 inline-block rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Вход
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="rounded-2xl border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs text-zinc-500">Баланс</div>
                <div className="text-2xl font-semibold">
                  {wallet ? formatRub(wallet.balance_kopeks) : "—"}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Расшифровка любого теста: <span className="font-medium">99 ₽</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTopupOpen(true)}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Пополнить
                </button>
                <button
                  onClick={refresh}
                  className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                >
                  Обновить
                </button>
              </div>
            </div>

            {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
            {loading ? <div className="mt-2 text-xs text-zinc-500">⏳ Загружаю…</div> : null}

            <div className="mt-4 rounded-xl border bg-zinc-50 p-3 text-xs text-zinc-700">
              <div className="font-medium">Как это работает</div>
              <div className="mt-1">
                Ты пополняешь внутренний баланс через СБП (QR). Дальше расшифровка любого
                теста открывается списанием <b>ровно 99 ₽</b> с этого баланса.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4">
            <div className="text-sm font-medium">История</div>
            <div className="mt-2 overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500">
                    <th className="py-2">Дата</th>
                    <th className="py-2">Сумма</th>
                    <th className="py-2">Причина</th>
                    <th className="py-2">Ссылка</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((row) => (
                    <tr key={row.id} className="border-t">
                      <td className="py-2 text-xs text-zinc-600">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="py-2">{formatRub(row.amount_kopeks)}</td>
                      <td className="py-2">{row.reason}</td>
                      <td className="py-2 text-xs text-zinc-600">{row.ref ?? "—"}</td>
                    </tr>
                  ))}
                  {ledger.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-xs text-zinc-500">
                        Пока пусто
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {topupOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-md rounded-2xl border bg-white p-4 shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Пополнить баланс</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Откроем страницу ЮKassa для СБП (QR). После оплаты вернёшься назад,
                      а баланс обновится автоматически.
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!topupBusy) {
                        setTopupOpen(false);
                        setTopupError(null);
                      }
                    }}
                    className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
                  >
                    Закрыть
                  </button>
                </div>

                <div className="mt-4">
                  <div className="text-xs text-zinc-500">Сумма (₽)</div>
                  <input
                    value={amountRub}
                    onChange={(e) => setAmountRub(e.target.value)}
                    inputMode="numeric"
                    placeholder="500"
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-zinc-200"
                  />

                  <div className="mt-3 flex flex-wrap gap-2">
                    {QUICK_AMOUNTS.map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setAmountRub(String(a))}
                        className="rounded-full border bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
                      >
                        {a} ₽
                      </button>
                    ))}
                  </div>

                  {topupError ? (
                    <div className="mt-3 text-sm text-red-600">{topupError}</div>
                  ) : null}

                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      disabled={topupBusy}
                      onClick={() => {
                        setTopupOpen(false);
                        setTopupError(null);
                      }}
                      className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      disabled={topupBusy || parsedRub === null || parsedRub < 1}
                      onClick={() => startTopup(parsedRub || 0)}
                      className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                    >
                      {topupBusy ? "Создаю оплату…" : "Перейти к оплате"}
                    </button>
                  </div>

                  <div className="mt-3 text-[11px] text-zinc-500">
                    Минимум 1 ₽. Комиссии и чек — по настройкам ЮKassa.
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Layout>
  );
}
