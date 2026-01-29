import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";
import { useWalletBalance } from "@/lib/useWalletBalance";
import type { ScoreResult } from "@/lib/score";

function Digits({ result }: { result: ScoreResult }) {
  const kind = result.kind;
  if (kind === "forced_pair_v1") {
    const total = result.total || 0;
    return (
      <div className="rounded-2xl border bg-white p-4">
        <div className="mb-2 text-sm font-semibold">Ваши результаты (цифры)</div>
        <div className="grid gap-2">
          {result.ranked.map((r) => (
            <div key={r.tag} className="flex items-center justify-between rounded-xl border bg-zinc-50 px-3 py-2">
              <div className="text-sm font-medium">{r.style}</div>
              <div className="text-sm text-zinc-700">
                {r.count}/{total} · {r.level}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const maxByFactor = (result.meta as any)?.maxByFactor || {};
  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="mb-2 text-sm font-semibold">Ваши результаты (цифры)</div>
      <div className="grid gap-2">
        {result.ranked.map((r) => (
          <div key={r.tag} className="flex items-center justify-between rounded-xl border bg-zinc-50 px-3 py-2">
            <div className="text-sm font-medium">{r.style}</div>
            <div className="text-sm text-zinc-700">
              {r.count}/{maxByFactor[r.tag] ?? "?"} · {r.level}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TrainingDone() {
  const router = useRouter();
  const roomId = String(router.query.roomId || "");
  const slug = String(router.query.slug || "");
  const attemptId = String(router.query.attempt || "");

  const { session } = useSession();
  const { balanceRub } = useWalletBalance();
  const safeBalanceRub = Number.isFinite(balanceRub) ? balanceRub : 0;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const unlock = async () => {
    if (!session) {
      router.push(`/auth?next=${encodeURIComponent(router.asPath)}`);
      return;
    }
    if (!attemptId) return;

    setErr("");
    setBusy(true);
    try {
      const r = await fetch("/api/training/self/unlock", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ attempt_id: attemptId }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось открыть результаты");
      setResult(j.result as ScoreResult);
      setUnlocked(true);
    } catch (e: any) {
      setErr(e?.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title="Тест завершён">
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-lg font-semibold">Готово ✅</div>
        <div className="mt-1 text-sm text-zinc-700">
          Результаты в цифрах доступны специалисту в комнате. Если вам очень нужно узнать заранее — можно открыть личную
          расшифровку за высокий порог.
        </div>
        <div className="mt-3 text-xs text-zinc-500">Баланс: {safeBalanceRub.toFixed(2)} ₽</div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={unlock}
            disabled={busy || !attemptId}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "…" : "Открыть личные результаты — 5000 ₽"}
          </button>
          <Link
            href={`/training/rooms/${encodeURIComponent(roomId)}`}
            className="rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            Назад в комнату
          </Link>
        </div>

        {attemptId ? (
          <div className="mt-3">
            <Link
              href={`/training/results?attempt=${encodeURIComponent(attemptId)}`}
              className="text-sm font-medium text-zinc-900 underline"
            >
              Открыть расшифровку от специалиста (без цифр)
            </Link>
            <div className="mt-1 text-xs text-zinc-500">Появится здесь, когда специалист нажмёт «Сгенерировать».</div>
          </div>
        ) : null}

        {err ? <div className="mt-3 text-sm text-red-600">{err}</div> : null}
      </div>

      {unlocked && result ? (
        <div className="mt-4">
          <Digits result={result} />
          <div className="mt-2 text-xs text-zinc-500">
            Пожалуйста, помните: в тренинге важен контекст и разбор со специалистом.
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
