import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";

/**
 * Remove "shared" marker from an attempt so the participant no longer sees it in LK.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { attempt_id } = (req.body || {}) as any;
  const attemptId = String(attempt_id || "").trim();
  if (!attemptId) return res.status(400).json({ ok: false, error: "attempt_id is required" });

  // Load attempt to validate room membership
  const { data: attempt, error: aErr } = await supabaseAdmin
    .from("training_attempts")
    .select("id,room_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (aErr) return res.status(500).json({ ok: false, error: aErr.message });
  if (!attempt) return res.status(404).json({ ok: false, error: "Attempt not found" });

  const { data: mem, error: mErr } = await supabaseAdmin
    .from("training_room_members")
    .select("role")
    .eq("room_id", attempt.room_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (mErr) return res.status(500).json({ ok: false, error: mErr.message });
  if (!mem || mem.role !== "specialist") return res.status(403).json({ ok: false, error: "Forbidden" });

  const { error: dErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .delete()
    .eq("attempt_id", attemptId)
    .eq("kind", "shared");

  if (dErr) return res.status(500).json({ ok: false, error: dErr.message });
  return res.status(200).json({ ok: true });
}
