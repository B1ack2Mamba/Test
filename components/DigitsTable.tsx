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

  const topBelbin =
    kind === "belbin_v1"
      ? [...(result.ranked || [])]
          .sort((a: any, b: any) => Number(b?.count ?? 0) - Number(a?.count ?? 0))
          .slice(0, 3)
      : null;

  const sgMeta = (() => {
    if (kind !== "situational_guidance_v1") return null;
    const adequacy = meta?.adequacy || {};
    const flexibility = meta?.flexibility || {};
    const diagonal = Number(adequacy?.diagonal ?? (result as any)?.counts?.diagonal ?? 0);
    const upper = Number(adequacy?.upper ?? (result as any)?.counts?.upper ?? 0);
    const lower = Number(adequacy?.lower ?? (result as any)?.counts?.lower ?? 0);
    const near = Number(adequacy?.near ?? (result as any)?.counts?.near ?? 0);

    return {
      flexibility: Number(flexibility?.sum ?? (result as any)?.counts?.flexibility ?? 0),
      flexibilityLevel: String(flexibility?.level ?? ""),
      diagonal,
      near,
      upper,
      lower,
    };
  })();

  return (
    <div className="grid gap-3">
      {topBelbin ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {topBelbin.map((r: any, i: number) => (
            <div key={String(r.tag)} className="rounded-2xl border bg-white/55 p-3">
              <div className="text-[11px] font-semibold text-zinc-600">Топ {i + 1}</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">{r.style}</div>
              <div className="mt-1 text-lg font-semibold text-zinc-900">{r.count}</div>
            </div>
          ))}
        </div>
      ) : null}

      {sgMeta ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border bg-white/55 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Гибкость применения стилей</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{sgMeta.flexibility}</div>
            <div className="mt-1 text-xs text-zinc-600">{sgMeta.flexibilityLevel || "—"}</div>
          </div>
          <div className="rounded-2xl border bg-white/55 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Адекватность применения стилей</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{sgMeta.diagonal}</div>
            <div className="mt-1 text-xs text-zinc-600">По диагонали</div>
          </div>
          <div className="rounded-2xl border bg-white/55 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Попустительский</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{sgMeta.upper}</div>
            <div className="mt-1 text-xs text-zinc-600">Ситуаций</div>
          </div>
          <div className="rounded-2xl border bg-white/55 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Излишний контроль</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900">{sgMeta.lower}</div>
            <div className="mt-1 text-xs text-zinc-600">Ситуаций</div>
          </div>
          {sgMeta.near ? (
            <div className="rounded-2xl border bg-white/45 p-3 sm:col-span-2 xl:col-span-4">
              <div className="text-[11px] text-zinc-500">Рядом с диагональю: {sgMeta.near}</div>
            </div>
          ) : null}
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
              const stripe = idx % 2 === 0 ? "bg-white/55" : "bg-white/35";

              return (
                <tr key={String(r.tag)} className={["border-b align-top", stripe].join(" ")}>
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
                    <div className="font-semibold">{r.count}</div>
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
