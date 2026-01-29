import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";

/**
 * Mark an attempt as "shared" so the participant can see it in their LK ("Мои результаты").
 * Minimal approach: store a marker row in training_attempt_interpretations with kind='shared'.
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

  // Load attempt
  const { data: attempt, error: aErr } = await supabaseAdmin
    .from("training_attempts")
    .select("id,room_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (aErr) return res.status(500).json({ ok: false, error: aErr.message });
  if (!attempt) return res.status(404).json({ ok: false, error: "Attempt not found" });

  // Ensure this specialist is actually a specialist member of that room (basic safety)
  const { data: mem, error: mErr } = await supabaseAdmin
    .from("training_room_members")
    .select("role")
    .eq("room_id", attempt.room_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (mErr) return res.status(500).json({ ok: false, error: mErr.message });
  if (!mem || mem.role !== "specialist") return res.status(403).json({ ok: false, error: "Forbidden" });

  const payload = {
    shared_by: user.email,
    shared_at: new Date().toISOString(),
  };

  const { error: uErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .upsert(
      {
        attempt_id: attemptId,
        kind: "shared",
        text: JSON.stringify(payload),
      },
      { onConflict: "attempt_id,kind" }
    );

  if (uErr) return res.status(500).json({ ok: false, error: uErr.message });

  return res.status(200).json({ ok: true });
}
