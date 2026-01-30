import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { hashPassword } from "@/lib/password";
import { isSpecialistUser } from "@/lib/specialist";
import { ensureRoomTests } from "@/lib/trainingRoomTests";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { name, password } = (req.body || {}) as any;
  const roomName = String(name || "").trim();
  const roomPwd = String(password || "").trim();

  if (!roomName) return res.status(400).json({ ok: false, error: "Название комнаты обязательно" });
  if (roomPwd.length < 4) return res.status(400).json({ ok: false, error: "Пароль минимум 4 символа" });

  let password_hash = "";
  try {
    password_hash = hashPassword(roomPwd);
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Bad password" });
  }

  const { data, error } = await supabaseAdmin
    .from("training_rooms")
    .insert({
      name: roomName,
      password_hash,
      created_by: user.id,
      created_by_email: user.email,
      is_active: true,
    })
    .select("id,name,created_at,created_by_email")
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });

  // ensure specialist is in members list too
  await supabaseAdmin.from("training_room_members").upsert(
    {
      room_id: data.id,
      user_id: user.id,
      display_name: user.email || "specialist",
      role: "specialist",
      last_seen: new Date().toISOString(),
    },
    { onConflict: "room_id,user_id" }
  );

  // init tests for this room
  try {
    await ensureRoomTests(supabaseAdmin as any, data.id);
  } catch (e) {
    // ignore; room still created
  }

  return res.status(200).json({ ok: true, room: data });
}
