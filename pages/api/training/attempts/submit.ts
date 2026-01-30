import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { loadTestJsonBySlugAdmin } from "@/lib/loadTestAdmin";
import { scoreForcedPair, scorePairSplit, scoreColorTypes, scoreUSK } from "@/lib/score";
import { ensureRoomTests } from "@/lib/trainingRoomTests";
import type { Tag } from "@/lib/testTypes";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const { room_id, test_slug, answers } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  const slug = String(test_slug || "").trim();

  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });
  if (!slug) return res.status(400).json({ ok: false, error: "test_slug is required" });

  // must be member
  const { data: member, error: memErr } = await supabaseAdmin
    .from("training_room_members")
    .select("id,role,display_name")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr || !member) return res.status(403).json({ ok: false, error: "Сначала войдите в комнату" });

  // room-specific enabled tests
  try {
    const roomTests = await ensureRoomTests(supabaseAdmin as any, roomId);
    const rt = roomTests.find((r: any) => String(r.test_slug) === slug);
    if (rt && rt.is_enabled === false) {
      return res.status(403).json({ ok: false, error: "Этот тест выключен для комнаты" });
    }
  } catch (e) {
    // If config table doesn't exist yet, we don't block (for backward compatibility).
  }


  const test = await loadTestJsonBySlugAdmin(supabaseAdmin as any, slug);
  if (!test) return res.status(404).json({ ok: false, error: "Тест не найден" });

  let result: any = null;
  let answersJson: any = answers;

  try {
    if (test.type === "forced_pair" || test.type === "forced_pair_v1") {
      const tags = Array.isArray(answers) ? (answers as string[]) : [];
      const chosen = tags.filter(Boolean) as Tag[];
      result = scoreForcedPair(test as any, chosen);
      answersJson = { chosen };
    } else if (test.type === "pair_sum5_v1" || test.type === "pair_split_v1") {
      const leftPoints = Array.isArray(answers) ? (answers as number[]) : [];
      result = scorePairSplit(test as any, leftPoints);
      answersJson = { leftPoints };
    } else if (test.type === "color_types_v1") {
      const a = (answers || {}) as any;
      const colorAnswers = {
        q1: a.q1,
        q2: a.q2,
        q3: Array.isArray(a.q3) ? a.q3 : [],
        q4: Array.isArray(a.q4) ? a.q4 : [],
        q5: Array.isArray(a.q5) ? a.q5 : [],
        q6: Array.isArray(a.q6) ? a.q6 : [],
      };
      result = scoreColorTypes(test as any, colorAnswers as any);
      answersJson = { color: colorAnswers };
    } else if (test.type === "usk_v1") {
      const vals = Array.isArray(answers) ? (answers as any[]) : [];
      const numeric = vals.map((v) => Number(v));
      result = scoreUSK(test as any, numeric);
      answersJson = { usk: numeric };
    } else {
      return res.status(400).json({ ok: false, error: "Unknown test type" });
    }
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: e?.message || "Bad answers" });
  }

  // Store attempt (specialist-only table)
  const { data: attempt, error: insErr } = await supabaseAdmin
    .from("training_attempts")
    .insert({
      room_id: roomId,
      user_id: user.id,
      test_slug: slug,
      answers: answersJson,
      result,
    })
    .select("id,created_at")
    .single();

  if (insErr) return res.status(500).json({ ok: false, error: insErr.message });

  // Update progress
  const now = new Date().toISOString();
  const { error: progErr } = await supabaseAdmin
    .from("training_progress")
    .upsert(
      {
        room_id: roomId,
        user_id: user.id,
        test_slug: slug,
        started_at: now,
        completed_at: now,
        attempt_id: attempt.id,
      },
      { onConflict: "room_id,user_id,test_slug" }
    );

  if (progErr) return res.status(500).json({ ok: false, error: progErr.message });

  return res.status(200).json({ ok: true, attempt_id: attempt.id });
}
