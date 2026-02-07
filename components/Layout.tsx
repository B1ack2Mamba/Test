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
  { ssr: false, loading: () => <span className="text-xs text-zinc-500">…</span> }
);

export function Layout({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="font-semibold tracking-tight">Авторские тесты</div>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href="/"
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Тесты
            </Link>
            <Link
              href="/training"
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Тренинги
            </Link>
            {PAYMENTS_UI_ENABLED ? (
              <Link
                href="/wallet"
                className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
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
        {title ? <h1 className="mb-4 text-2xl font-semibold">{title}</h1> : null}
        {children}
      </main>

      <footer className="border-t bg-white">
        <div className="mx-auto max-w-4xl px-4 py-5 text-xs text-zinc-500">&nbsp;</div>
      </footer>
    </div>
  );
}
