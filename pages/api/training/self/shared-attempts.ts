import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";

type SharedAttempt = {
  attempt_id: string;
  test_slug: string;
  room_id: string;
  room_name: string | null;
  created_at: string;
  shared_at: string;
  has_interpretation: boolean;
};

/**
 * List attempts that a specialist has "shared" with the participant.
 * Participant sees them in /training/my-results.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  // 1) shared markers
  const { data: sharedRows, error: sErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .select("attempt_id,created_at")
    .eq("kind", "shared")
    .order("created_at", { ascending: false });

  if (sErr) return res.status(500).json({ ok: false, error: sErr.message });

  const sharedIds = (sharedRows || []).map((r: any) => String(r.attempt_id)).filter(Boolean);
  if (sharedIds.length === 0) return res.status(200).json({ ok: true, attempts: [] as SharedAttempt[] });

  // 2) attempts (only those belonging to this user)
  const { data: attempts, error: aErr } = await supabaseAdmin
    .from("training_attempts")
    .select("id,test_slug,room_id,created_at,user_id")
    .in("id", sharedIds)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (aErr) return res.status(500).json({ ok: false, error: aErr.message });

  const ownedIds = (attempts || []).map((a: any) => String(a.id));
  if (ownedIds.length === 0) return res.status(200).json({ ok: true, attempts: [] as SharedAttempt[] });

  // 3) interpretation availability
  const { data: keysRows, error: kErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .select("attempt_id")
    .in("attempt_id", ownedIds)
    .eq("kind", "keys_ai");
  if (kErr) return res.status(500).json({ ok: false, error: kErr.message });
  const hasKeys = new Set((keysRows || []).map((r: any) => String(r.attempt_id)));

  const sharedAtMap = new Map<string, string>();
  for (const r of sharedRows || []) {
    const id = String((r as any).attempt_id);
    if (!sharedAtMap.has(id)) sharedAtMap.set(id, String((r as any).created_at));
  }

  const out: SharedAttempt[] = (attempts || []).map((a: any) => ({
    attempt_id: String(a.id),
    test_slug: String(a.test_slug),
    room_id: String(a.room_id),
    room_name: null,
    created_at: String(a.created_at),
    shared_at: sharedAtMap.get(String(a.id)) || String(a.created_at),
    has_interpretation: hasKeys.has(String(a.id)),
  }));

  // Room names (nice UX in LK)
  const roomIds = Array.from(new Set(out.map((x) => x.room_id))).filter(Boolean);
  if (roomIds.length) {
    const { data: rooms } = await supabaseAdmin
      .from("training_rooms")
      .select("id,name")
      .in("id", roomIds);
    const rm = new Map<string, string>();
    for (const r of rooms || []) rm.set(String((r as any).id), String((r as any).name));
    for (const row of out) row.room_name = rm.get(row.room_id) || null;
  }

  return res.status(200).json({ ok: true, attempts: out });
}
