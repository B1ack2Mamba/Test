import type { ScoreResult } from "@/lib/score";

/**
 * Compact "digits-only" table for participants.
 * Shows numeric values without long text interpretations.
 */
export function DigitsTable({ result }: { result: ScoreResult }) {
  if (!result?.ranked?.length) {
    return <div className="text-sm text-zinc-500">Нет данных.</div>;
  }

  const kind = result.kind;
  const meta: any = (result as any).meta || {};
  const isNumericPrimary = kind === "usk_v1" || kind === "16pf_v1";

  const denomByKind = (tag: string) => {
    if (kind === "forced_pair_v1") return (result as any).total;
    if (kind === "color_types_v1") return (result as any).total;
    if (kind === "pair_sum5_v1") {
      const m = (result as any).meta?.maxByFactor;
      const d = m?.[tag];
      return Number.isFinite(d) ? Number(d) : null;
    }
    if (kind === "usk_v1") return (result as any).total || 10;
    if (kind === "16pf_v1") return 10;
    if (kind === "belbin_v1") return 70;
    return null;
  };

  const rawByScale = meta?.rawByScale || {};

  const topBelbin =
    kind === "belbin_v1"
      ? [...(result.ranked || [])]
          .sort((a: any, b: any) => Number(b?.count ?? 0) - Number(a?.count ?? 0))
          .slice(0, 3)
      : null;

  return (
    <div className="grid gap-3">
      {topBelbin ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {topBelbin.map((r: any, i: number) => (
            <div key={String(r.tag)} className="rounded-2xl border bg-white/55 p-3">
              <div className="text-[11px] font-semibold text-zinc-600">Топ {i + 1}</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">{r.style}</div>
              <div className="mt-1 text-xs text-zinc-600">
                {r.count}/70 · {r.percent}%
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2 text-left font-medium text-zinc-700">Шкала</th>
            <th className="py-2 text-left font-medium text-zinc-700">Значение</th>
          </tr>
        </thead>
        <tbody>
          {result.ranked.map((r: any, idx: number) => {
            const denom = denomByKind(String(r.tag));
            const stripe = idx % 2 === 0 ? "bg-white/55" : "bg-white/35";
            const raw = kind === "usk_v1" ? rawByScale?.[r.tag] : null;

            const value = (() => {
              if (isNumericPrimary) {
                // USK / 16PF: show sten-like 0..10 values.
                const base = `${r.count}/10`;
                return raw !== null && raw !== undefined ? `${base} (сырые: ${raw})` : base;
              }
              // Percent-based tests.
              if (typeof r.percent === "number") {
                if (typeof denom === "number") return `${r.percent}% (${r.count}/${denom})`;
                return `${r.percent}% (${r.count})`;
              }
              // Fallback.
              return typeof denom === "number" ? `${r.count}/${denom}` : String(r.count);
            })();

            return (
              <tr key={String(r.tag)} className={["border-b align-top", stripe].join(" ")}
              >
                <td className="py-3 pr-4 text-zinc-900">
                  {kind === "16pf_v1" ? (
                    <div className="font-medium">{r.style}</div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex min-w-6 items-center justify-center rounded-md border bg-white px-1.5 py-0.5 text-[11px] text-zinc-700">
                        {String(r.tag)}
                      </span>
                      <span className="font-medium">{r.style}</span>
                    </div>
                  )}
                </td>
                <td className="py-3 text-zinc-900">
                  <div className="font-semibold">{value}</div>
                  {/* digits-only: do not show qualitative levels */}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
