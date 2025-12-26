import type { ScoreResult } from "@/lib/score";

export type LocalAttempt = {
  id: string;
  slug: string;
  created_at: number; // ms
  result: ScoreResult;

  /**
   * Локальный кэш оплат (важно: это НЕ источник истины по деньгам).
   * Нужен только чтобы не списывать повторно за просмотр одной и той же попытки.
   */
  paid_author?: {
    at: number; // ms
    content: any; // payload из public.test_interpretations
  };
  paid_detail?: {
    at: number; // ms
    text: string;
  };
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

export function saveAttempt(userId: string, slug: string, result: ScoreResult, limit = 20): LocalAttempt | null {
  if (typeof window === "undefined") return null;
  const id = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  const a: LocalAttempt = { id, slug, created_at: Date.now(), result };
  const k = keyFor(userId, slug);
  const prev = safeParse<LocalAttempt[]>(window.localStorage.getItem(k)) ?? [];
  const next = [a, ...prev].slice(0, limit);
  window.localStorage.setItem(k, JSON.stringify(next));
  return a;
}

export function loadAttempts(userId: string, slug: string): LocalAttempt[] {
  if (typeof window === "undefined") return [];
  const k = keyFor(userId, slug);
  return safeParse<LocalAttempt[]>(window.localStorage.getItem(k)) ?? [];
}

export function getAttempt(userId: string, slug: string, attemptId: string): LocalAttempt | null {
  if (typeof window === "undefined") return null;
  const list = loadAttempts(userId, slug);
  return list.find((a) => a.id === attemptId) ?? null;
}

export function updateAttempt(
  userId: string,
  slug: string,
  attemptId: string,
  patch: Partial<LocalAttempt>
): LocalAttempt | null {
  if (typeof window === "undefined") return null;
  const k = keyFor(userId, slug);
  const prev = safeParse<LocalAttempt[]>(window.localStorage.getItem(k)) ?? [];
  let updated: LocalAttempt | null = null;
  const next = prev.map((a) => {
    if (a.id !== attemptId) return a;
    updated = { ...a, ...patch };
    return updated;
  });
  window.localStorage.setItem(k, JSON.stringify(next));
  return updated;
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
