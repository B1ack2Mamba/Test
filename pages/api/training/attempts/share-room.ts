import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";

/**
 * Share ALL completed attempts in a room (for participant users) to their LK.
 * This is a convenience action for the specialist: "send to everyone".
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { room_id } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  // Must be a specialist member of the room
  const { data: mem, error: mErr } = await supabaseAdmin
    .from("training_room_members")
    .select("role")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (mErr) return res.status(500).json({ ok: false, error: mErr.message });
  if (!mem || mem.role !== "specialist") return res.status(403).json({ ok: false, error: "Forbidden" });

  // Participant users in the room
  const { data: members, error: mmErr } = await supabaseAdmin
    .from("training_room_members")
    .select("user_id,role")
    .eq("room_id", roomId);
  if (mmErr) return res.status(500).json({ ok: false, error: mmErr.message });
  const participantIds = new Set(
    (members || [])
      .filter((x: any) => x.role === "participant")
      .map((x: any) => String(x.user_id))
      .filter(Boolean)
  );

  // Completed attempts in the room (attempt row exists only after submit)
  const { data: attempts, error: aErr } = await supabaseAdmin
    .from("training_attempts")
    .select("id,user_id")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });
  if (aErr) return res.status(500).json({ ok: false, error: aErr.message });

  const attemptIds = (attempts || [])
    .filter((a: any) => participantIds.has(String(a.user_id)))
    .map((a: any) => String(a.id));

  if (attemptIds.length === 0) {
    return res.status(200).json({ ok: true, added: 0, total: 0 });
  }

  // Already shared?
  const { data: existing, error: eErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .select("attempt_id")
    .in("attempt_id", attemptIds)
    .eq("kind", "shared");
  if (eErr) return res.status(500).json({ ok: false, error: eErr.message });
  const existingSet = new Set((existing || []).map((x: any) => String(x.attempt_id)));

  const now = new Date().toISOString();
  const payload = JSON.stringify({ shared_by: user.email, shared_at: now, bulk: true });

  const toInsert = attemptIds
    .filter((id) => !existingSet.has(id))
    .map((id) => ({ attempt_id: id, kind: "shared", text: payload }));

  if (toInsert.length === 0) {
    return res.status(200).json({ ok: true, added: 0, total: attemptIds.length });
  }

  const { error: iErr } = await supabaseAdmin.from("training_attempt_interpretations").insert(toInsert);
  if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

  return res.status(200).json({ ok: true, added: toInsert.length, total: attemptIds.length });
}
