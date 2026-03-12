import type { NextApiRequest, NextApiResponse } from "next";
import { requireTrainingRoomAccess } from "@/lib/trainingRoomServerSession";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { room_id, display_name } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  const name = String(display_name || "").trim();

  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });
  if (!name) return res.status(400).json({ ok: false, error: "display_name is required" });
  if (name.length > 80) return res.status(400).json({ ok: false, error: "Слишком длинное имя" });

  const access = await requireTrainingRoomAccess(req, res, roomId);
  if (!access) return;
  const { member, supabaseAdmin, user } = access;

  const { error: upErr } = await supabaseAdmin
    .from("training_room_members")
    .update({ display_name: name })
    .eq("id", member.id);

  if (upErr) return res.status(500).json({ ok: false, error: upErr.message });

  try {
    await (supabaseAdmin as any)
      .from("training_room_sessions")
      .update({ display_name: name, last_seen: new Date().toISOString() })
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .gt("expires_at", new Date().toISOString());
  } catch {
    // ignore session table update if migration is not applied yet
  }

  return res.status(200).json({ ok: true, display_name: name });
}
