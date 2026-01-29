import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const attemptId = String(req.query.attempt_id || "").trim();
  if (!attemptId) return res.status(400).json({ ok: false, error: "attempt_id is required" });

  const { data, error } = await supabaseAdmin
    .from("training_attempts")
    // Include `answers` so the specialist can see which options were chosen.
    .select("id,room_id,user_id,test_slug,answers,result,created_at")
    .eq("id", attemptId)
    .maybeSingle();

  if (error || !data) return res.status(404).json({ ok: false, error: "Attempt not found" });

  // Also load cached interpretation (if any)
  const { data: interp } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .select("kind,text,created_at")
    .eq("attempt_id", attemptId);

  return res.status(200).json({ ok: true, attempt: data, interpretations: interp ?? [] });
}
