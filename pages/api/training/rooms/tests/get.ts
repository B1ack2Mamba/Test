import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { ensureRoomTests } from "@/lib/trainingRoomTests";
import { isSpecialistUser } from "@/lib/specialist";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: false });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const roomId = String(req.query.room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  // must be a member
  const { data: member, error: memErr } = await supabaseAdmin
    .from("training_room_members")
    .select("role")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr || !member) return res.status(403).json({ ok: false, error: "Сначала войдите в комнату" });

  try {
    const rows = await ensureRoomTests(supabaseAdmin as any, roomId);
    const isSpec = member.role === "specialist" && isSpecialistUser(user);
    const out = isSpec ? rows : rows.filter((r) => !!r.is_enabled);
    return res.status(200).json({ ok: true, room_tests: out });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to load room tests" });
  }
}
