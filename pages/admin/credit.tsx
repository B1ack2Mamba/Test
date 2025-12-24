import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";

export default function CreditPage() {
  const { user } = useSession();
  const [adminToken, setAdminToken] = useState<string>("");
  const [amountRub, setAmountRub] = useState<string>("100");
  const [status, setStatus] = useState<string>("");

  const uid = user?.id ?? "";
  const canSend = useMemo(() => {
    const n = Number(amountRub);
    return Boolean(uid) && Number.isFinite(n) && n > 0 && adminToken.trim().length > 0;
  }, [uid, amountRub, adminToken]);

  const credit = async () => {
    if (!uid) {
      setStatus("❌ Сначала войди" );
      return;
    }
    const n = Number(amountRub);
    if (!Number.isFinite(n) || n <= 0) {
      setStatus("❌ Некорректная сумма" );
      return;
    }
    setStatus("⏳ Начисляю...");
    try {
      const r = await fetch("/api/admin/credit-wallet", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify({ user_id: uid, amount_rub: n, reason: "topup", ref: "admin" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStatus(`❌ ${j?.error ?? "Ошибка"}`);
        return;
      }
      setStatus(`✅ Ок: баланс (коп.) = ${j?.data?.balance_kopeks ?? "?"}`);
    } catch (e: any) {
      setStatus(`❌ ${e?.message ?? "Ошибка"}`);
    }
  };

  return (
    <Layout title="Админ: начисление в кошелёк">
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-zinc-700">
          Это служебная страница для тестов/ручного пополнения. Для работы нужен серверный
          <code className="mx-1 rounded bg-zinc-100 px-1">ADMIN_UPLOAD_TOKEN</code>.
        </div>

        <div className="mt-3 rounded-xl border bg-zinc-50 p-3 text-sm">
          <div>
            user_id: <span className="font-mono">{uid || "(не авторизован)"}</span>
          </div>
          {!uid ? (
            <div className="mt-2 text-xs text-zinc-600">
              Перейди в <a className="underline" href="/auth">/auth</a> и войди по email.
            </div>
          ) : null}
        </div>

        <div className="mt-3 grid gap-2">
          <input
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="ADMIN_UPLOAD_TOKEN"
            className="w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
          />
          <input
            value={amountRub}
            onChange={(e) => setAmountRub(e.target.value)}
            placeholder="Сумма (RUB)"
            className="w-full rounded-xl border bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
          />
          <button
            disabled={!canSend}
            onClick={credit}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white enabled:hover:bg-zinc-800 disabled:opacity-50"
          >
            Начислить
          </button>
        </div>

        {status ? <div className="mt-3 text-sm text-zinc-700">{status}</div> : null}
      </div>
    </Layout>
  );
}
