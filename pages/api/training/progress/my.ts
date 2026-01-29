import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const roomId = String(req.query.room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  const { data, error } = await supabaseAdmin
    .from("training_progress")
    .select("test_slug,started_at,completed_at,attempt_id")
    .eq("room_id", roomId)
    .eq("user_id", user.id);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(200).json({ ok: true, progress: data ?? [] });
}
