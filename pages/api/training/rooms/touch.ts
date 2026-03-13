import type { NextApiRequest, NextApiResponse } from "next";
import { requireTrainingRoomAccess } from "@/lib/trainingRoomServerSession";
import { setNoStore } from "@/lib/apiHardening";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { room_id } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  const access = await requireTrainingRoomAccess(req, res, roomId);
  if (!access) return;
  const { user, supabaseAdmin, sessionStrict } = access;

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("training_room_members")
    .update({ last_seen: now })
    .eq("room_id", roomId)
    .eq("user_id", user.id);

  if (error) return res.status(500).json({ ok: false, error: error.message });

  if (sessionStrict) {
    try {
      await (supabaseAdmin as any)
        .from("training_room_sessions")
        .update({ last_seen: now })
        .eq("room_id", roomId)
        .eq("user_id", user.id)
        .gt("expires_at", now);
    } catch {
      // ignore non-critical session touch errors
    }
  }

  return res.status(200).json({ ok: true });
}
