import Link from "next/link";
import React from "react";
import dynamic from "next/dynamic";
import { PAYMENTS_UI_ENABLED } from "@/lib/payments";

// Auth UI depends on browser-only session state.
// Render client-side only to avoid SSR hydration mismatches.
const SpecialistNavNoSSR = dynamic(
  () => import("@/components/SpecialistNav").then((m) => m.SpecialistNav),
  { ssr: false, loading: () => null }
);

const AuthNavNoSSR = dynamic(
  () => import("@/components/AuthNav").then((m) => m.AuthNav),
  { ssr: false, loading: () => <span className="text-xs text-slate-500">…</span> }
);

export function Layout({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-app text-slate-900">
      <header className="border-b border-white/60 bg-white/55 backdrop-blur-sm">
        <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-semibold tracking-tight">Авторские тесты</div>
          <nav className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
            <Link
              href="/"
              className="btn btn-secondary btn-sm"
            >
              Тесты
            </Link>
            <Link
              href="/training"
              className="btn btn-secondary btn-sm"
            >
              Тренинги
            </Link>
            {PAYMENTS_UI_ENABLED ? (
              <Link
                href="/wallet"
                className="btn btn-secondary btn-sm"
              >
                Кошелёк
              </Link>
            ) : null}

            <SpecialistNavNoSSR />
            <AuthNavNoSSR />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {title ? <h1 className="mb-4 text-2xl font-semibold tracking-tight">{title}</h1> : null}
        {children}
      </main>

      <footer className="border-t border-white/60 bg-white/45 backdrop-blur-sm">
        <div className="mx-auto max-w-4xl px-4 py-5 text-xs text-slate-500">&nbsp;</div>
      </footer>
    </div>
  );
}
