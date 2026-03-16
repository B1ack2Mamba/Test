import type { NextApiRequest, NextApiResponse } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { requireUser, type AuthedUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { retryTransientApi } from "@/lib/apiHardening";

export const TRAINING_ROOM_SERVER_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const COOKIE_PREFIX = "training_room_session_v1_";

type SessionRow = {
  id?: string;
  room_id: string;
  user_id: string;
  role?: string | null;
  display_name?: string | null;
  token_hash: string;
  created_at?: string | null;
  last_seen?: string | null;
  expires_at: string;
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeRoomId(roomId: string) {
  return String(roomId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getBearerToken(req: NextApiRequest): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

function createSupabaseAdminFromEnv(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export function getTrainingRoomSessionCookieName(roomId: string) {
  return `${COOKIE_PREFIX}${normalizeRoomId(roomId)}`;
}

function parseCookies(req: NextApiRequest): Record<string, string> {
  const raw = String(req.headers.cookie || "");
  const out: Record<string, string> = {};
  for (const part of raw.split(/;\s*/)) {
    if (!part) continue;
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function serializeCookie(name: string, value: string, opts?: { expires?: Date; maxAge?: number; httpOnly?: boolean; path?: string; sameSite?: "Lax" | "Strict" | "None"; secure?: boolean }) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts?.path || "/"}`);
  if (typeof opts?.maxAge === "number") parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
  if (opts?.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  parts.push(`SameSite=${opts?.sameSite || "Lax"}`);
  if (opts?.httpOnly !== false) parts.push("HttpOnly");
  if (opts?.secure ?? process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function appendSetCookie(res: NextApiResponse, cookie: string) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  if (Array.isArray(current)) {
    res.setHeader("Set-Cookie", [...current, cookie]);
    return;
  }
  res.setHeader("Set-Cookie", [String(current), cookie]);
}

function isMissingSessionTableError(message: string) {
  return /training_room_sessions/i.test(message || "") && /(does not exist|not exist|relation|schema cache|column)/i.test(message || "");
}

export function setTrainingRoomSessionCookie(res: NextApiResponse, roomId: string, token: string, expiresAt: string | Date) {
  const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const maxAge = Math.max(0, Math.floor((d.getTime() - Date.now()) / 1000));
  appendSetCookie(
    res,
    serializeCookie(getTrainingRoomSessionCookieName(roomId), token, {
      expires: d,
      maxAge,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    })
  );
}

export function clearTrainingRoomSessionCookie(res: NextApiResponse, roomId: string) {
  appendSetCookie(
    res,
    serializeCookie(getTrainingRoomSessionCookieName(roomId), "", {
      expires: new Date(0),
      maxAge: 0,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    })
  );
}

export async function createTrainingRoomServerSession(
  supabaseAdmin: SupabaseClient,
  args: { roomId: string; userId: string; displayName?: string; role?: string | null; ttlMs?: number }
): Promise<{ ok: true; token: string; expiresAt: string } | { ok: false; tableMissing: true } | { ok: false; error: string }> {
  const token = randomBytes(32).toString("hex");
  const ttlMs = Math.max(60_000, Number(args.ttlMs || TRAINING_ROOM_SERVER_SESSION_TTL_MS));
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const payload: SessionRow = {
    room_id: args.roomId,
    user_id: args.userId,
    role: args.role || "participant",
    display_name: args.displayName || "",
    token_hash: hashToken(token),
    last_seen: new Date().toISOString(),
    expires_at: expiresAt,
  };

  try {
    await retryTransientApi(
      () => (supabaseAdmin as any).from("training_room_sessions").delete().eq("room_id", args.roomId).eq("user_id", args.userId),
      { attempts: 2, delayMs: 120 }
    );
  } catch {
    // non-critical cleanup failure; insert below will still decide the outcome
  }

  const insertResult = await retryTransientApi<any>(
    () => (supabaseAdmin as any).from("training_room_sessions").insert(payload),
    { attempts: 2, delayMs: 150 }
  );
  const error = insertResult?.error;
  if (error) {
    if (isMissingSessionTableError(String(error.message || ""))) return { ok: false, tableMissing: true };
    return { ok: false, error: error.message || "Не удалось создать сессию комнаты" };
  }

  return { ok: true, token, expiresAt };
}

export async function getTrainingRoomServerSession(
  req: NextApiRequest,
  supabaseAdmin: SupabaseClient,
  args: { roomId: string; userId: string }
): Promise<{ row: SessionRow | null; tableMissing?: boolean; error?: string }> {
  const token = parseCookies(req)[getTrainingRoomSessionCookieName(args.roomId)];
  if (!token) return { row: null };

  const { data, error } = await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from("training_room_sessions")
      .select("id,room_id,user_id,role,display_name,token_hash,created_at,last_seen,expires_at")
      .eq("room_id", args.roomId)
      .eq("user_id", args.userId)
      .eq("token_hash", hashToken(token))
      .maybeSingle(),
    { attempts: 2, delayMs: 150 }
  );

  if (error) {
    if (isMissingSessionTableError(String(error.message || ""))) return { row: null, tableMissing: true };
    return { row: null, error: error.message || "Не удалось проверить сессию комнаты" };
  }

  const row = (data || null) as SessionRow | null;
  if (!row) return { row: null };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    try {
      await (supabaseAdmin as any).from("training_room_sessions").delete().eq("token_hash", row.token_hash);
    } catch {
      // ignore cleanup errors
    }
    return { row: null };
  }

  return { row };
}

export async function getActiveTrainingRoomSessionRoomIds(
  req: NextApiRequest,
  supabaseAdmin: SupabaseClient,
  userId: string,
  roomIds: string[]
): Promise<{ roomIds: Set<string>; tableMissing?: boolean; error?: string }> {
  const cookies = parseCookies(req);
  const candidates = roomIds
    .map((roomId) => {
      const token = cookies[getTrainingRoomSessionCookieName(roomId)];
      return token ? { roomId, tokenHash: hashToken(token) } : null;
    })
    .filter(Boolean) as { roomId: string; tokenHash: string }[];

  if (!candidates.length) return { roomIds: new Set<string>() };

  const tokenHashes = candidates.map((c) => c.tokenHash);
  const wantedRoomIds = candidates.map((c) => c.roomId);

  const { data, error } = await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from("training_room_sessions")
      .select("room_id,token_hash,expires_at")
      .eq("user_id", userId)
      .in("room_id", wantedRoomIds)
      .in("token_hash", tokenHashes)
      .gt("expires_at", new Date().toISOString()),
    { attempts: 2, delayMs: 150 }
  );

  if (error) {
    if (isMissingSessionTableError(String(error.message || ""))) return { roomIds: new Set<string>(), tableMissing: true };
    return { roomIds: new Set<string>(), error: error.message || "Не удалось получить активные сессии комнат" };
  }

  return { roomIds: new Set((data || []).map((row: any) => String(row.room_id))) };
}

export async function getTrainingRoomServerSessionByCookie(
  req: NextApiRequest,
  supabaseAdmin: SupabaseClient,
  roomId: string
): Promise<{ row: SessionRow | null; tableMissing?: boolean; error?: string }> {
  const token = parseCookies(req)[getTrainingRoomSessionCookieName(roomId)];
  if (!token) return { row: null };

  const { data, error } = await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from("training_room_sessions")
      .select("id,room_id,user_id,role,display_name,token_hash,created_at,last_seen,expires_at")
      .eq("room_id", roomId)
      .eq("token_hash", hashToken(token))
      .maybeSingle(),
    { attempts: 2, delayMs: 150 }
  );

  if (error) {
    if (isMissingSessionTableError(String(error.message || ""))) return { row: null, tableMissing: true };
    return { row: null, error: error.message || "Не удалось проверить cookie-сессию комнаты" };
  }

  const row = (data || null) as SessionRow | null;
  if (!row) return { row: null };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    try {
      await (supabaseAdmin as any).from("training_room_sessions").delete().eq("token_hash", row.token_hash);
    } catch {
      // ignore cleanup errors
    }
    return { row: null };
  }

  return { row };
}

export async function requireTrainingRoomAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  roomId: string,
  opts?: { requireEmail?: boolean }
): Promise<{ user: AuthedUser; supabaseAdmin: SupabaseClient; member: any; isSpecialist: boolean; sessionStrict: boolean } | null> {
  const hasBearer = Boolean(getBearerToken(req));

  if (hasBearer) {
    const auth = await requireUser(req, res, { requireEmail: opts?.requireEmail });
    if (!auth) return null;
    const { user, supabaseAdmin } = auth;

    const { data: member, error: memErr } = await (supabaseAdmin as any)
      .from("training_room_members")
      .select("id,role,display_name")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr || !member) {
      res.status(403).json({ ok: false, error: "Сначала войдите в комнату" });
      return null;
    }

    const isSpecialist = member.role === "specialist" && isSpecialistUser(user);
    if (isSpecialist) return { user, supabaseAdmin, member, isSpecialist: true, sessionStrict: false };

    const sessionState = await getTrainingRoomServerSession(req, supabaseAdmin, { roomId, userId: user.id });
    if (sessionState.error) {
      res.status(500).json({ ok: false, error: sessionState.error });
      return null;
    }
    if (sessionState.tableMissing) {
      return { user, supabaseAdmin, member, isSpecialist: false, sessionStrict: false };
    }
    if (!sessionState.row) {
      res.status(403).json({ ok: false, error: "Сессия комнаты истекла. Войдите снова.", code: "ROOM_SESSION_EXPIRED" });
      return null;
    }

    return { user, supabaseAdmin, member, isSpecialist: false, sessionStrict: true };
  }

  let supabaseAdmin: SupabaseClient;
  try {
    supabaseAdmin = createSupabaseAdminFromEnv();
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || "Server env missing" });
    return null;
  }

  const sessionState = await getTrainingRoomServerSessionByCookie(req, supabaseAdmin, roomId);
  if (sessionState.error) {
    res.status(500).json({ ok: false, error: sessionState.error });
    return null;
  }
  if (sessionState.tableMissing) {
    res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    return null;
  }
  if (!sessionState.row) {
    res.status(403).json({ ok: false, error: "Сессия комнаты истекла. Войдите снова.", code: "ROOM_SESSION_EXPIRED" });
    return null;
  }

  const user: AuthedUser = {
    id: sessionState.row.user_id,
    email: null,
    user_metadata: {},
    app_metadata: {},
  };

  const { data: member, error: memErr } = await (supabaseAdmin as any)
    .from("training_room_members")
    .select("id,role,display_name")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr || !member) {
    res.status(403).json({ ok: false, error: "Сначала войдите в комнату" });
    return null;
  }

  return { user, supabaseAdmin, member, isSpecialist: false, sessionStrict: true };
}
