import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const { room_id, display_name } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  const name = String(display_name || "").trim();

  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });
  if (!name) return res.status(400).json({ ok: false, error: "display_name is required" });
  if (name.length > 80) return res.status(400).json({ ok: false, error: "Слишком длинное имя" });

  const { data: mem, error: memErr } = await supabaseAdmin
    .from("training_room_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr || !mem) return res.status(403).json({ ok: false, error: "Сначала войдите в комнату" });

  const { error: upErr } = await supabaseAdmin
    .from("training_room_members")
    .update({ display_name: name })
    .eq("id", mem.id);

  if (upErr) return res.status(500).json({ ok: false, error: upErr.message });

  return res.status(200).json({ ok: true, display_name: name });
}
