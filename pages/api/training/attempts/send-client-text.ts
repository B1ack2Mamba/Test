import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";

/**
 * Save an interpretation text that will be visible to the participant (no digits) and mark the attempt as shared.
 * Specialist can edit the text before sending.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { attempt_id, text } = (req.body || {}) as any;
  const attemptId = String(attempt_id || "").trim();
  const payloadText = String(text || "").trim();
  if (!attemptId) return res.status(400).json({ ok: false, error: "attempt_id is required" });
  if (!payloadText) return res.status(400).json({ ok: false, error: "text is required" });

  // Load attempt
  const { data: attempt, error: aErr } = await supabaseAdmin
    .from("training_attempts")
    .select("id,room_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (aErr) return res.status(500).json({ ok: false, error: aErr.message });
  if (!attempt) return res.status(404).json({ ok: false, error: "Attempt not found" });

  // Ensure this specialist is actually a specialist member of that room
  const { data: mem, error: mErr } = await supabaseAdmin
    .from("training_room_members")
    .select("role")
    .eq("room_id", attempt.room_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (mErr) return res.status(500).json({ ok: false, error: mErr.message });
  if (!mem || mem.role !== "specialist") return res.status(403).json({ ok: false, error: "Forbidden" });

  // 1) Save client-facing text
  const { error: tErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .upsert(
      { attempt_id: attemptId, kind: "client_text", text: payloadText },
      { onConflict: "attempt_id,kind" }
    );
  if (tErr) return res.status(500).json({ ok: false, error: tErr.message });

  // 2) Mark as shared
  const payload = { shared_by: user.email, shared_at: new Date().toISOString() };
  const { error: sErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .upsert(
      { attempt_id: attemptId, kind: "shared", text: JSON.stringify(payload) },
      { onConflict: "attempt_id,kind" }
    );
  if (sErr) return res.status(500).json({ ok: false, error: sErr.message });

  return res.status(200).json({ ok: true });
}
