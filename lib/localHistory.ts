import type { ScoreResult } from "@/lib/score";

export type LocalAttempt = {
  id: string;
  slug: string;
  created_at: number; // ms
  result: ScoreResult;
};

function keyFor(userId: string, slug: string) {
  return `history:${userId}:${slug}`;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveAttempt(userId: string, slug: string, result: ScoreResult, limit = 20) {
  if (typeof window === "undefined") return;
  const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  const a: LocalAttempt = { id, slug, created_at: Date.now(), result };
  const k = keyFor(userId, slug);
  const prev = safeParse<LocalAttempt[]>(window.localStorage.getItem(k)) ?? [];
  const next = [a, ...prev].slice(0, limit);
  window.localStorage.setItem(k, JSON.stringify(next));
}

export function loadAttempts(userId: string, slug: string): LocalAttempt[] {
  if (typeof window === "undefined") return [];
  const k = keyFor(userId, slug);
  return safeParse<LocalAttempt[]>(window.localStorage.getItem(k)) ?? [];
}

export function formatLocalDate(tsMs: number): string {
  try {
    return new Date(tsMs).toLocaleString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(tsMs);
  }
}
