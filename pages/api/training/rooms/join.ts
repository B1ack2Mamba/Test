import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { verifyPassword } from "@/lib/password";
import { isSpecialistUser } from "@/lib/specialist";
import { createTrainingRoomServerSession, setTrainingRoomSessionCookie } from "@/lib/trainingRoomServerSession";
import { setNoStore } from "@/lib/apiHardening";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const { room_id, password, display_name, personal_data_consent } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  const pwd = String(password || "").trim();
  const name = String(display_name || "").trim();

  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });
  if (!pwd) return res.status(400).json({ ok: false, error: "Пароль обязателен" });
  if (!name) return res.status(400).json({ ok: false, error: "Имя обязательно" });
  if (!Boolean(personal_data_consent)) {
    return res.status(400).json({ ok: false, error: "Нужно подтвердить согласие на обработку персональных данных" });
  }

  const { data: room, error: roomErr } = await supabaseAdmin
    .from("training_rooms")
    .select("id,password_hash,is_active")
    .eq("id", roomId)
    .maybeSingle();

  if (roomErr || !room) return res.status(404).json({ ok: false, error: "Комната не найдена" });
  if (!room.is_active) return res.status(400).json({ ok: false, error: "Комната не активна" });

  if (!verifyPassword(pwd, room.password_hash)) {
    return res.status(403).json({ ok: false, error: "Неверный пароль" });
  }

  const role = isSpecialistUser(user) ? "specialist" : "participant";

  const consentAt = new Date().toISOString();
  const basePayload: any = {
    room_id: roomId,
    user_id: user.id,
    display_name: name,
    role,
    last_seen: consentAt,
  };

  const upsertMember = async (withConsentCols: boolean) => {
    const payload: any = { ...basePayload };
    if (withConsentCols) {
      payload.personal_data_consent = true;
      payload.personal_data_consent_at = consentAt;
    }
    return await supabaseAdmin
      .from("training_room_members")
      .upsert(payload, { onConflict: "room_id,user_id" })
      .select("id,room_id,user_id,display_name,role,joined_at,last_seen")
      .single();
  };

  let { data: member, error } = await upsertMember(true);
  if (error && /personal_data_consent(_at)?/i.test(error.message || "")) {
    ({ data: member, error } = await upsertMember(false));
  }

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const roomSession = await createTrainingRoomServerSession(supabaseAdmin as any, {
    roomId,
    userId: user.id,
    displayName: name,
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
  });
}
