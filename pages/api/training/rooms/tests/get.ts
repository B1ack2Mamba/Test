import type { NextApiRequest, NextApiResponse } from "next";
import { ensureRoomTests } from "@/lib/trainingRoomTests";
import { requireTrainingRoomAccess } from "@/lib/trainingRoomServerSession";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const roomId = String(req.query.room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  const access = await requireTrainingRoomAccess(req, res, roomId);
  if (!access) return;
  const { supabaseAdmin, isSpecialist } = access;

  try {
    const rows = await ensureRoomTests(supabaseAdmin as any, roomId);
    const out = isSpecialist ? rows : rows.filter((r) => !!r.is_enabled);
    return res.status(200).json({ ok: true, room_tests: out });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to load room tests" });
  }
}
