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
  const suffix = `${Date.now()}-${randomUUID()}-${randomBytes(6).toString("hex")}`;
  return `guest+${safeRoom}-${suffix}@participant.local`;
}

function makeGuestPassword() {
  return `Guest-${randomBytes(24).toString("base64url")}`;
}

function parsePositiveInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

type QueueTicket = {
  id: string;
  room_id: string;
  queue_token: string;
  display_name: string | null;
  status: "queued" | "admitted" | "completed" | "failed" | "cancelled";
  created_at: string;
  admitted_at?: string | null;
  completed_at?: string | null;
  last_seen_at?: string | null;
  error_message?: string | null;
};

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

async function createJoinTicket(supabaseAdmin: any, roomId: string, displayName: string) {
  const queueToken = randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from("training_room_join_queue")
      .insert({ room_id: roomId, queue_token: queueToken, display_name: displayName, status: "queued", last_seen_at: now })
      .select("id,room_id,queue_token,display_name,status,created_at,admitted_at,completed_at,last_seen_at,error_message")
      .single(),
    { attempts: 2, delayMs: 120 }
  );
  return { data: data as QueueTicket | null, error };
}

async function getJoinTicket(supabaseAdmin: any, roomId: string, queueToken: string) {
  const { data, error } = await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from("training_room_join_queue")
      .select("id,room_id,queue_token,display_name,status,created_at,admitted_at,completed_at,last_seen_at,error_message")
      .eq("room_id", roomId)
      .eq("queue_token", queueToken)
      .maybeSingle(),
    { attempts: 2, delayMs: 120 }
  );
  return { data: data as QueueTicket | null, error };
}

async function touchJoinTicket(supabaseAdmin: any, roomId: string, queueToken: string) {
  const now = new Date().toISOString();
  return await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from("training_room_join_queue")
      .update({ last_seen_at: now })
      .eq("room_id", roomId)
      .eq("queue_token", queueToken),
    { attempts: 2, delayMs: 80 }
  );
}

async function getQueueState(supabaseAdmin: any, ticket: QueueTicket, batchSize: number) {
  const activeStatuses = ["queued", "admitted"];

  const [{ count: aheadCount, error: aheadErr }, { count: admittedCount, error: admittedErr }] = await Promise.all([
    retryTransientApi<any>(
      () => (supabaseAdmin as any)
        .from("training_room_join_queue")
        .select("id", { count: "exact", head: true })
        .eq("room_id", ticket.room_id)
        .in("status", activeStatuses)
        .is("completed_at", null)
        .lt("created_at", ticket.created_at),
      { attempts: 2, delayMs: 80 }
    ),
    retryTransientApi<any>(
      () => (supabaseAdmin as any)
        .from("training_room_join_queue")
        .select("id", { count: "exact", head: true })
        .eq("room_id", ticket.room_id)
        .eq("status", "admitted")
        .is("completed_at", null),
      { attempts: 2, delayMs: 80 }
    ),
  ]);

  if (aheadErr || admittedErr) {
    return {
      ok: false,
      error: aheadErr || admittedErr,
      approxPosition: 1,
      shouldAdmit: false,
      activeAdmitted: 0,
    };
  }

  const approxPosition = Number(aheadCount || 0) + 1;
  const activeAdmitted = Number(admittedCount || 0);
  const shouldAdmit = approxPosition <= batchSize && activeAdmitted < batchSize;

  return {
    ok: true,
    approxPosition,
    shouldAdmit,
    activeAdmitted,
  };
}

async function admitJoinTicket(supabaseAdmin: any, roomId: string, queueToken: string) {
  const now = new Date().toISOString();
  const { data, error } = await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from("training_room_join_queue")
      .update({ status: "admitted", admitted_at: now, last_seen_at: now })
      .eq("room_id", roomId)
      .eq("queue_token", queueToken)
      .eq("status", "queued")
      .select("id,room_id,queue_token,display_name,status,created_at,admitted_at,completed_at,last_seen_at,error_message")
      .maybeSingle(),
    { attempts: 2, delayMs: 80 }
  );
  return { data: data as QueueTicket | null, error };
}

async function completeJoinTicket(supabaseAdmin: any, roomId: string, queueToken: string, status: "completed" | "failed", errorMessage?: string | null) {
  const now = new Date().toISOString();
  return await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from("training_room_join_queue")
      .update({ status, completed_at: now, last_seen_at: now, error_message: errorMessage || null })
      .eq("room_id", roomId)
      .eq("queue_token", queueToken),
    { attempts: 2, delayMs: 80 }
  );
}

async function cleanupOldJoinTickets(supabaseAdmin: any, roomId: string) {
  const before = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from("training_room_join_queue")
      .delete()
      .eq("room_id", roomId)
      .lt("created_at", before),
    { attempts: 1, delayMs: 50 }
  ).catch(() => null);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { room_id, password, display_name, name, personal_data_consent, queue_token } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  const pwd = String(password || "").trim();
  const displayName = String(display_name || name || "").trim();
  const queueTokenInput = String(queue_token || "").trim();

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

  const hasBearer = Boolean(getBearerToken(req));

  const queueWindowSeconds = parsePositiveInt(process.env.TRAINING_JOIN_QUEUE_WINDOW_SECONDS, 8);
  const queueThreshold = parsePositiveInt(process.env.TRAINING_JOIN_QUEUE_THRESHOLD, 60);
  const queueRetryBaseMs = parsePositiveInt(process.env.TRAINING_JOIN_QUEUE_RETRY_MS, 1800);
  const queueBatchSize = parsePositiveInt(process.env.TRAINING_JOIN_QUEUE_BATCH_SIZE, 40);

  let queueToken = queueTokenInput;
  let joinQueueTableMissing = false;
  let queueTicket: QueueTicket | null = null;

  if (!hasBearer) {
    await cleanupOldJoinTickets(supabaseAdmin as any, roomId);

    if (!queueToken) {
      const created = await createJoinTicket(supabaseAdmin as any, roomId, displayName);
      if (created.error && /training_room_join_queue/i.test(String(created.error?.message || ""))) {
        joinQueueTableMissing = true;
      } else if (created.error || !created.data?.queue_token) {
        return res.status(500).json({ ok: false, error: created.error?.message || "Не удалось поставить в очередь на вход" });
      } else {
        queueTicket = created.data;
        queueToken = created.data.queue_token;
      }
    } else {
      const existing = await getJoinTicket(supabaseAdmin as any, roomId, queueToken);
      if (existing.error && /training_room_join_queue/i.test(String(existing.error?.message || ""))) {
        joinQueueTableMissing = true;
      } else if (existing.error) {
        return res.status(500).json({ ok: false, error: existing.error.message || "Не удалось проверить очередь входа" });
      } else if (!existing.data) {
        return res.status(409).json({ ok: false, error: "Очередь входа устарела. Попробуйте войти ещё раз." });
      } else {
        queueTicket = existing.data;
        await touchJoinTicket(supabaseAdmin as any, roomId, queueToken).catch(() => null);
      }
    }

    if (!joinQueueTableMissing && queueTicket) {
      const state = await getQueueState(supabaseAdmin as any, queueTicket, queueBatchSize);
      if (!state.ok) {
        const retryAfterMs = Math.min(12000, queueRetryBaseMs + 1200 + Math.floor(Math.random() * 700));
        return res.status(202).json({
          ok: false,
          queued: true,
          queue_token: queueToken,
          error: "Сейчас много входов, продолжаем обрабатывать очередь…",
          retry_after_ms: retryAfterMs,
          approx_position: 1,
        });
      }
      if (!state.shouldAdmit && queueTicket.status !== "admitted") {
        const overload = Math.max(0, state.approxPosition - queueBatchSize);
        const retryAfterMs = Math.min(12000, queueRetryBaseMs + overload * 80 + Math.floor(Math.random() * 500));
        return res.status(202).json({
          ok: false,
          queued: true,
          queue_token: queueToken,
          error: "Сейчас много входов, подключаем вас в порядке очереди…",
          retry_after_ms: retryAfterMs,
          approx_position: state.approxPosition,
        });
      }

      if (queueTicket.status === "queued") {
        const admitted = await admitJoinTicket(supabaseAdmin as any, roomId, queueToken);
        if (admitted.error) {
          const retryAfterMs = Math.min(12000, queueRetryBaseMs + 1000 + Math.floor(Math.random() * 700));
          return res.status(202).json({
            ok: false,
            queued: true,
            queue_token: queueToken,
            error: "Сейчас много входов, продолжаем обрабатывать очередь…",
            retry_after_ms: retryAfterMs,
            approx_position: 1,
          });
        }
        if (admitted.data) queueTicket = admitted.data;
      }
    }

    if (joinQueueTableMissing) {
      const recentJoinInfo = await countRecentRoomJoins(supabaseAdmin as any, roomId, queueWindowSeconds);
      if (!recentJoinInfo.error && recentJoinInfo.count >= queueThreshold) {
        const overload = Math.max(0, recentJoinInfo.count - queueThreshold + 1);
        const retryAfterMs = Math.min(10000, queueRetryBaseMs + overload * 35 + Math.floor(Math.random() * 400));
        const approxPosition = overload;
        return res.status(202).json({
          ok: false,
          queued: true,
          queue_token: queueToken || null,
          error: "Сейчас много входов, подключаем вас в порядке очереди…",
          retry_after_ms: retryAfterMs,
          approx_position: approxPosition,
        });
      }
    }
  }

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
    for (let attempt = 1; attempt <= 4; attempt += 1) {
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
      await new Promise((resolve) => setTimeout(resolve, 80 + Math.floor(Math.random() * 120)));
    }

    if (createErr || !created?.user?.id) {
      if (queueToken) {
        await completeJoinTicket(supabaseAdmin as any, roomId, queueToken, "failed", createErr?.message || "guest_create_failed").catch(() => null);
      }
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

  if (error) {
    if (queueToken) {
      await completeJoinTicket(supabaseAdmin as any, roomId, queueToken, "failed", error.message || "member_upsert_failed").catch(() => null);
    }
    return res.status(500).json({ ok: false, error: error.message });
  }

  const roomSession = await createTrainingRoomServerSession(supabaseAdmin as any, {
    roomId,
    userId,
    displayName,
    role,
  });

  if (roomSession.ok) {
    setTrainingRoomSessionCookie(res, roomId, roomSession.token, roomSession.expiresAt);
  } else if (!("tableMissing" in roomSession && roomSession.tableMissing)) {
    if (queueToken) {
      await completeJoinTicket(supabaseAdmin as any, roomId, queueToken, "failed", ("error" in roomSession ? roomSession.error : undefined) || "room_session_failed").catch(() => null);
    }
    return res.status(500).json({ ok: false, error: ("error" in roomSession ? roomSession.error : undefined) || "Не удалось создать сессию комнаты" });
  }

  if (queueToken) {
    await completeJoinTicket(supabaseAdmin as any, roomId, queueToken, "completed", null).catch(() => null);
  }

  return res.status(200).json({
    ok: true,
    member,
    room_session_expires_at: roomSession.ok ? roomSession.expiresAt : null,
    room_session_enabled: roomSession.ok,
    guest_created: guestCreated,
  });
}
