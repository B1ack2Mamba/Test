import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { room_id, name } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  const roomName = String(name || "").trim();

  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });
  if (!roomName) return res.status(400).json({ ok: false, error: "Название комнаты обязательно" });

  const { data: room, error: roomErr } = await supabaseAdmin
    .from("training_rooms")
    .select("id,created_by")
    .eq("id", roomId)
    .maybeSingle();

  if (roomErr) return res.status(500).json({ ok: false, error: roomErr.message });
  if (!room) return res.status(404).json({ ok: false, error: "Комната не найдена" });
  if (room.created_by && room.created_by !== user.id) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { data, error } = await supabaseAdmin
    .from("training_rooms")
    .update({ name: roomName })
    .eq("id", roomId)
    .select("id,name")
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, room: data });
}
