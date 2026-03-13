import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { requireUser } from "@/lib/serverAuth";
import { verifyPassword } from "@/lib/password";
import { isSpecialistUser } from "@/lib/specialist";
import { createTrainingRoomServerSession, setTrainingRoomSessionCookie } from "@/lib/trainingRoomServerSession";
import { retryTransientApi, setNoStore } from "@/lib/apiHardening";

function createSupabaseAdminFromEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function getBearerToken(req: NextApiRequest): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

function makeGuestEmail(roomId: string) {
  const safeRoom = String(roomId || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) || "room";
  const suffix = `${Date.now()}-${randomUUID()}-${randomBytes(4).toString("hex")}`;
  return `guest+${safeRoom}-${suffix}@participant.local`;
}

function makeGuestPassword() {
  return `Guest-${randomBytes(24).toString("base64url")}`;
}

function parsePositiveInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function countRecentRoomJoins(supabaseAdmin: any, roomId: string, windowSeconds: number) {
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await (supabaseAdmin as any)
    .from("training_room_members")
    .select("user_id", { count: "exact", head: true })
    .eq("room_id", roomId)
    .gte("joined_at", since);

  if (error) return { count: 0, error };
  return { count: Number(count || 0), error: null };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { room_id, password, display_name, name, personal_data_consent } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  const pwd = String(password || "").trim();
  const displayName = String(display_name || name || "").trim();

  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });
  if (!pwd) return res.status(400).json({ ok: false, error: "Пароль обязателен" });
  if (!displayName) return res.status(400).json({ ok: false, error: "Имя обязательно" });
  if (!Boolean(personal_data_consent)) {
    return res.status(400).json({ ok: false, error: "Нужно подтвердить согласие на обработку персональных данных" });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = createSupabaseAdminFromEnv();
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Server env missing" });
  }

  const { data: room, error: roomErr } = await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from("training_rooms")
      .select("id,password_hash,is_active")
      .eq("id", roomId)
      .maybeSingle(),
    { attempts: 2, delayMs: 150 }
  );

  if (roomErr || !room) return res.status(404).json({ ok: false, error: "Комната не найдена" });
  if (!room.is_active) return res.status(400).json({ ok: false, error: "Комната не активна" });
  if (!verifyPassword(pwd, room.password_hash)) {
    return res.status(403).json({ ok: false, error: "Неверный пароль" });
  }

  const joinWindowSeconds = parsePositiveInt(process.env.TRAINING_JOIN_QUEUE_WINDOW_SECONDS, 8);
  const joinThreshold = parsePositiveInt(process.env.TRAINING_JOIN_QUEUE_THRESHOLD, 80);
  const queueRetryBaseMs = parsePositiveInt(process.env.TRAINING_JOIN_QUEUE_RETRY_MS, 1500);

  const recentJoinInfo = await countRecentRoomJoins(supabaseAdmin as any, roomId, joinWindowSeconds);
  if (!recentJoinInfo.error && recentJoinInfo.count >= joinThreshold) {
    const overload = Math.max(0, recentJoinInfo.count - joinThreshold + 1);
    const retryAfterMs = Math.min(8000, queueRetryBaseMs + overload * 35 + Math.floor(Math.random() * 400));
    const approxPosition = overload;
    return res.status(202).json({
      ok: false,
      queued: true,
      error: "Сейчас много входов, подключаем вас в порядке очереди…",
      retry_after_ms: retryAfterMs,
      approx_position: approxPosition,
    });
  }

  const hasBearer = Boolean(getBearerToken(req));

  let userId = "";
  let role: "participant" | "specialist" = "participant";
  let guestCreated = false;

  if (hasBearer) {
    const auth = await requireUser(req, res, { requireEmail: true });
    if (!auth) return;
    userId = auth.user.id;
    role = isSpecialistUser(auth.user) ? "specialist" : "participant";
  } else {
    let created: any = null;
    let createErr: any = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const guestEmail = makeGuestEmail(roomId);
      const guestPassword = makeGuestPassword();
      const result = await (supabaseAdmin as any).auth.admin.createUser({
        email: guestEmail,
        password: guestPassword,
        email_confirm: true,
        user_metadata: { role: "participant", room_guest: true, display_name: displayName },
        app_metadata: { role: "participant", room_guest: true },
      });
      created = result?.data || null;
      createErr = result?.error || null;
      if (created?.user?.id) break;
      const msg = String(createErr?.message || "");
      if (!/already been registered|duplicate|exists/i.test(msg)) break;
    }

    if (createErr || !created?.user?.id) {
      return res.status(500).json({ ok: false, error: createErr?.message || "Не удалось создать гостевого участника" });
    }

    userId = String(created.user.id);
    guestCreated = true;
    role = "participant";
  }

  const consentAt = new Date().toISOString();
  const basePayload: any = {
    room_id: roomId,
    user_id: userId,
    display_name: displayName,
    role,
    last_seen: consentAt,
  };

  const upsertMember = async (withConsentCols: boolean) => {
    const payload: any = { ...basePayload };
    if (withConsentCols) {
      payload.personal_data_consent = true;
      payload.personal_data_consent_at = consentAt;
    }
    return await retryTransientApi<any>(
      () => (supabaseAdmin as any)
        .from("training_room_members")
        .upsert(payload, { onConflict: "room_id,user_id" })
        .select("id,room_id,user_id,display_name,role,joined_at,last_seen")
        .single(),
      { attempts: 2, delayMs: 150 }
    );
  };

  let { data: member, error } = await upsertMember(true);
  if (error && /personal_data_consent(_at)?/i.test(error.message || "")) {
    ({ data: member, error } = await upsertMember(false));
  }

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const roomSession = await createTrainingRoomServerSession(supabaseAdmin as any, {
    roomId,
    userId,
    displayName,
    role,
  });

  if (roomSession.ok) {
    setTrainingRoomSessionCookie(res, roomId, roomSession.token, roomSession.expiresAt);
  } else if (!("tableMissing" in roomSession && roomSession.tableMissing)) {
    return res.status(500).json({ ok: false, error: ("error" in roomSession ? roomSession.error : undefined) || "Не удалось создать сессию комнаты" });
  }

  return res.status(200).json({
    ok: true,
    member,
    room_session_expires_at: roomSession.ok ? roomSession.expiresAt : null,
    room_session_enabled: roomSession.ok,
    guest_created: guestCreated,
  });
}
