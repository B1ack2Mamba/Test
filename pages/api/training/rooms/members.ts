import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const roomId = String(req.query.room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  const { data, error } = await supabaseAdmin
    .from("training_room_members")
    .select("id,user_id,display_name,role,joined_at,last_seen")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const now = Date.now();
  const onlineWindowMs = 240_000; // 4 minutes (touch runs every 90s)

  return res.status(200).json({
    ok: true,
    members: (data ?? []).map((m: any) => ({
      ...m,
      online: m.last_seen ? now - new Date(m.last_seen).getTime() < onlineWindowMs : false,
    })),
  });
}
