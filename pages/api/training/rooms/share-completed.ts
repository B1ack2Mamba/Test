import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";

/**
 * Share all completed attempts in a room to participants' LK.
 * Minimal implementation: insert "shared" markers in training_attempt_interpretations.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const roomId = String((req.body || {})?.room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  // Ensure specialist membership
  const { data: mem, error: mErr } = await supabaseAdmin
    .from("training_room_members")
    .select("role")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (mErr) return res.status(500).json({ ok: false, error: mErr.message });
  if (!mem || mem.role !== "specialist") return res.status(403).json({ ok: false, error: "Forbidden" });

  // Completed progress rows in this room
  const { data: rows, error: pErr } = await supabaseAdmin
    .from("training_progress")
    .select("attempt_id")
    .eq("room_id", roomId)
    .not("completed_at", "is", null)
    .not("attempt_id", "is", null);

  if (pErr) return res.status(500).json({ ok: false, error: pErr.message });

  const attemptIds = Array.from(
    new Set((rows || []).map((r: any) => String(r.attempt_id)).filter((x) => x && x !== "null"))
  );

  if (attemptIds.length === 0) {
    return res.status(200).json({ ok: true, total: 0, shared_now: 0, already_shared: 0 });
  }

  // Find already shared
  const { data: existing, error: eErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .select("attempt_id")
    .eq("kind", "shared")
    .in("attempt_id", attemptIds);

  if (eErr) return res.status(500).json({ ok: false, error: eErr.message });

  const already = new Set((existing || []).map((r: any) => String(r.attempt_id)));
  const missing = attemptIds.filter((id) => !already.has(id));

  if (missing.length === 0) {
    return res.status(200).json({ ok: true, total: attemptIds.length, shared_now: 0, already_shared: attemptIds.length });
  }

  const payload = {
    shared_by: user.email,
    shared_at: new Date().toISOString(),
  };

  const toUpsert = missing.map((id) => ({
    attempt_id: id,
    kind: "shared",
    text: JSON.stringify(payload),
  }));

  const { error: uErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .upsert(toUpsert, { onConflict: "attempt_id,kind" });

  if (uErr) return res.status(500).json({ ok: false, error: uErr.message });

  return res.status(200).json({ ok: true, total: attemptIds.length, shared_now: missing.length, already_shared: already.size });
}
