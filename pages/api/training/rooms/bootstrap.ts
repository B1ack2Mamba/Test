import type { NextApiRequest, NextApiResponse } from "next";
import { requireTrainingRoomAccess } from "@/lib/trainingRoomServerSession";
import { ensureRoomTests } from "@/lib/trainingRoomTests";
import { setNoStore } from "@/lib/apiHardening";

type AnyRow = Record<string, any>;

async function loadRoom(sb: any, roomId: string) {
  const selectRoom = async (withFlag: boolean) => {
    const sel = withFlag
      ? "id,name,created_by_email,is_active,participants_can_see_digits,analysis_prompt,group_analysis_prompt"
      : "id,name,created_by_email,is_active,analysis_prompt,group_analysis_prompt";
    return await sb.from("training_rooms").select(sel).eq("id", roomId).maybeSingle();
  };

  let { data: room, error } = await selectRoom(true);
  if (error && /(participants_can_see_digits|analysis_prompt|group_analysis_prompt)/i.test(error.message || "")) {
    ({ data: room, error } = await selectRoom(false));
    if (error && /(analysis_prompt|group_analysis_prompt)/i.test(error.message || "")) {
      ({ data: room, error } = await sb.from("training_rooms").select("id,name,created_by_email,is_active").eq("id", roomId).maybeSingle());
    }
  }

  return { room, error };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const roomId = String(req.query.room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  const access = await requireTrainingRoomAccess(req, res, roomId);
  if (!access) return;
  const { user, supabaseAdmin, member, isSpecialist: userIsSpecialist, sessionStrict } = access;

  const sb: any = supabaseAdmin as any;
  const { room, error } = await loadRoom(sb, roomId);
  if (error || !room) return res.status(404).json({ ok: false, error: "Room not found" });

  const effectiveMember = member ? { role: member.role, display_name: member.display_name } : null;
  const prefillDisplayName = member?.display_name || null;
  const requiresRejoin = false;

  let progress: AnyRow[] = [];
  let roomTests: AnyRow[] = [];

  const { data: progressData, error: progressError } = await sb
    .from("training_progress")
    .select("test_slug,started_at,completed_at,attempt_id")
    .eq("room_id", roomId)
    .eq("user_id", user.id);

  if (progressError) return res.status(500).json({ ok: false, error: progressError.message || "Не удалось загрузить прогресс" });
  progress = progressData || [];

  try {
    const rows = await ensureRoomTests(sb, roomId);
    roomTests = userIsSpecialist ? rows : rows.filter((r: any) => !!r.is_enabled);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Не удалось загрузить тесты комнаты" });
  }

  return res.status(200).json({
    ok: true,
    room: {
      id: room.id,
      name: room.name,
      created_by_email: room.created_by_email ?? null,
      is_active: room.is_active,
      participants_can_see_digits: Boolean((room as any)?.participants_can_see_digits),
      analysis_prompt: typeof (room as any)?.analysis_prompt === "string" ? (room as any).analysis_prompt : "",
      group_analysis_prompt: typeof (room as any)?.group_analysis_prompt === "string" ? (room as any).group_analysis_prompt : "",
    },
    member: effectiveMember,
    requires_rejoin: requiresRejoin,
    prefill_display_name: prefillDisplayName,
    session_strict: sessionStrict,
    progress,
    room_tests: roomTests,
  });
}
