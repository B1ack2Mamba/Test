import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { verifyPassword } from "@/lib/password";
import { isSpecialistUser } from "@/lib/specialist";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const { room_id, password, display_name } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  const pwd = String(password || "").trim();
  const name = String(display_name || "").trim();

  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });
  if (!pwd) return res.status(400).json({ ok: false, error: "Пароль обязателен" });
  if (!name) return res.status(400).json({ ok: false, error: "Имя обязательно" });

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

  const { data: member, error } = await supabaseAdmin
    .from("training_room_members")
    .upsert(
      {
        room_id: roomId,
        user_id: user.id,
        display_name: name,
        role,
        last_seen: new Date().toISOString(),
      },
      { onConflict: "room_id,user_id" }
    )
    .select("id,room_id,user_id,display_name,role,joined_at,last_seen")
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });

  return res.status(200).json({ ok: true, member });
}
