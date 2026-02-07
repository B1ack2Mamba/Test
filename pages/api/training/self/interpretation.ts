import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";

function safeJson(s: any): any {
  if (!s || typeof s !== "string") return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const attemptId = String(req.query.attempt_id || req.query.attempt || "").trim();
  if (!attemptId) return res.status(400).json({ ok: false, error: "attempt_id is required" });

  const { data: attempt, error: aErr } = await supabaseAdmin
    .from("training_attempts")
    .select("id,user_id,test_slug,room_id,result")
    .eq("id", attemptId)
    .maybeSingle();

  if (aErr) return res.status(500).json({ ok: false, error: aErr.message });
  if (!attempt) return res.status(404).json({ ok: false, error: "Попытка не найдена" });
  if (attempt.user_id !== user.id) return res.status(403).json({ ok: false, error: "Forbidden" });

  // Participant should see ONLY the client-facing text that the specialist decided to send.
  const { data: sharedRow } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .select("attempt_id,text")
    .eq("attempt_id", attemptId)
    .eq("kind", "shared")
    .maybeSingle();

  if (!sharedRow) {
    return res.status(200).json({ ok: true, text: "", attempt: { id: attempt.id, test_slug: attempt.test_slug, room_id: attempt.room_id }, shared: false, reveal_results: false, result: null });
  }

  const meta = safeJson((sharedRow as any).text);
  const revealResults = Boolean(meta?.reveal_results);

  const { data: interp, error: iErr } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .select("text")
    .eq("attempt_id", attemptId)
    .eq("kind", "client_text")
    .maybeSingle();

  if (iErr) return res.status(500).json({ ok: false, error: iErr.message });

  return res.status(200).json({
    ok: true,
    text: interp?.text || "",
    attempt: { id: attempt.id, test_slug: attempt.test_slug, room_id: attempt.room_id },
    shared: true,
    reveal_results: revealResults,
    result: revealResults ? attempt.result || null : null,
  });
}
