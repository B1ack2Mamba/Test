import React from "react";
import type { Tag } from "@/lib/testTypes";

export function LineChart({ data }: { data: { tag: Tag; percent: number }[] }) {
  const w = 640;
  const h = 220;
  const padX = 36;
  const padY = 24;

  const xFor = (i: number) => padX + (i * (w - padX * 2)) / Math.max(1, data.length - 1);
  const yFor = (p: number) => {
    const t = Math.max(0, Math.min(100, p));
    return padY + ((100 - t) * (h - padY * 2)) / 100;
  };

  const pts = data.map((d, i) => `${xFor(i)},${yFor(d.percent)}`).join(" ");
  const baselineY = yFor(0);

  return (
    <div className="w-full overflow-x-auto rounded-xl border bg-white p-3">
      <svg width={w} height={h} className="block">
        <line x1={padX} y1={baselineY} x2={w - padX} y2={baselineY} stroke="currentColor" opacity="0.15" />
        <line x1={padX} y1={yFor(50)} x2={w - padX} y2={yFor(50)} stroke="currentColor" opacity="0.08" />
        <line x1={padX} y1={yFor(100)} x2={w - padX} y2={yFor(100)} stroke="currentColor" opacity="0.05" />

        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={pts} />

        {data.map((d, i) => (
          <g key={d.tag}>
            <circle cx={xFor(i)} cy={yFor(d.percent)} r={4} fill="currentColor" />
            <text x={xFor(i)} y={h - 8} textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.8">
              {d.tag}
            </text>
            <text x={xFor(i)} y={yFor(d.percent) - 10} textAnchor="middle" fontSize="12" fill="currentColor" opacity="0.7">
              {d.percent}%
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
