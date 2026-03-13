import type { NextApiRequest, NextApiResponse } from "next";
import { requireTrainingRoomAccess } from "@/lib/trainingRoomServerSession";
import { setNoStore } from "@/lib/apiHardening";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const roomId = String(req.query.room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  const access = await requireTrainingRoomAccess(req, res, roomId);
  if (!access) return;
  const { user, supabaseAdmin } = access;

  const { data, error } = await supabaseAdmin
    .from("training_progress")
    .select("test_slug,started_at,completed_at,attempt_id")
    .eq("room_id", roomId)
    .eq("user_id", user.id);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, progress: data ?? [] });
}
