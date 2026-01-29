import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const attemptId = String(req.query.attempt_id || req.query.attempt || "").trim();
  if (!attemptId) return res.status(400).json({ ok: false, error: "attempt_id is required" });

  const { data: attempt, error: aErr } = await supabaseAdmin
    .from("training_attempts")
    .select("id,user_id,test_slug,room_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (aErr) return res.status(500).json({ ok: false, error: aErr.message });
  if (!attempt) return res.status(404).json({ ok: false, error: "Попытка не найдена" });
  if (attempt.user_id !== user.id) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { data: interp, error: iErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .select("text")
    .eq("attempt_id", attemptId)
    .eq("kind", "keys_ai")
    .maybeSingle();

  if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

  return res.status(200).json({ ok: true, text: interp?.text || "", attempt });
}
