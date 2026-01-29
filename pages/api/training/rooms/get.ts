import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const roomId = String(req.query.room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  const { data: room, error } = await supabaseAdmin
    .from("training_rooms")
    .select("id,name,created_by_email,is_active")
    .eq("id", roomId)
    .maybeSingle();

  if (error || !room) return res.status(404).json({ ok: false, error: "Room not found" });

  // check membership
  const { data: member } = await supabaseAdmin
    .from("training_room_members")
    .select("role,display_name")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();

  return res.status(200).json({
    ok: true,
    room: { id: room.id, name: room.name, created_by_email: room.created_by_email ?? null, is_active: room.is_active },
    member: member ? { role: member.role, display_name: member.display_name } : null,
  });
}
