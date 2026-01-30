import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { ensureRoomTests, enabledRoomTests } from "@/lib/trainingRoomTests";
import { isSpecialistUser } from "@/lib/specialist";
import type { ScoreResult } from "@/lib/score";

function miniFromResult(result: any): string {
  const r = result as ScoreResult;
  if (!r || typeof r !== "object") return "";
  if (r.kind === "color_types_v1") {
    const g = r.counts?.green ?? 0;
    const red = r.counts?.red ?? 0;
    const b = r.counts?.blue ?? 0;
    const top = Array.isArray(r.ranked) && r.ranked[0] ? r.ranked[0].style : "";
    return `З${g} К${red} С${b}${top ? ` · ${top}` : ""}`;
  }
  if (Array.isArray(r.ranked) && r.ranked.length) {
    const a = r.ranked[0];
    const b = r.ranked[1];
    const denomFor = (row: any) => {
      if (!row) return null;
      if (r.kind === "forced_pair_v1" || r.kind === "color_types_v1" || r.kind === "usk_v1") return r.total;
      if (r.kind === "pair_sum5_v1") {
        const m = (r as any).meta?.maxByFactor;
        const d = m?.[row.tag];
        return Number.isFinite(d) ? Number(d) : null;
      }
      return null;
    };
    const fmt = (row: any) => {
      if (!row) return "";
      const d = denomFor(row);
      const extra = d ? ` (${row.count}/${d})` : ` (${row.count})`;
      return `${row.style} ${row.percent}%${extra}`;
    };
    const s1 = a ? fmt(a) : "";
    const s2 = b ? fmt(b) : "";
    return s2 ? `${s1} / ${s2}` : s1;
  }
  return "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const roomId = String(req.query.room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  // must be a specialist member
  const { data: member, error: memErr } = await supabaseAdmin
    .from("training_room_members")
    .select("role")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (memErr || !member || member.role !== "specialist") return res.status(403).json({ ok: false, error: "Forbidden" });

  const { data: room, error: roomErr } = await supabaseAdmin
    .from("training_rooms")
    .select("id,name,created_by_email,is_active,created_at")
    .eq("id", roomId)
    .maybeSingle();
  if (roomErr || !room) return res.status(404).json({ ok: false, error: "Room not found" });

  try {
    const roomTests = await ensureRoomTests(supabaseAdmin as any, roomId);
    const enabled = enabledRoomTests(roomTests);
    const enabledSlugs = enabled.map((r) => r.test_slug);

    const { data: membersData, error: membersErr } = await supabaseAdmin
      .from("training_room_members")
      .select("id,user_id,display_name,role,joined_at,last_seen")
      .eq("room_id", roomId)
      .order("joined_at", { ascending: true });
    if (membersErr) return res.status(500).json({ ok: false, error: membersErr.message });

    const now = Date.now();
    const onlineWindowMs = 60_000;
    const members = (membersData ?? []).map((m: any) => ({
      ...m,
      online: m.last_seen ? now - new Date(m.last_seen).getTime() < onlineWindowMs : false,
    }));

    const { data: progressData, error: progErr } = await supabaseAdmin
      .from("training_progress")
      .select("room_id,user_id,test_slug,started_at,completed_at,attempt_id")
      .eq("room_id", roomId)
      .in("test_slug", enabledSlugs.length ? enabledSlugs : ["__none__"]);
    if (progErr) return res.status(500).json({ ok: false, error: progErr.message });

    const attemptIds = (progressData ?? [])
      .map((p: any) => p.attempt_id)
      .filter(Boolean) as string[];

    const { data: attemptsData, error: attErr } = attemptIds.length
      ? await supabaseAdmin
          .from("training_attempts")
          .select("id,user_id,test_slug,result,created_at")
          .in("id", attemptIds)
      : { data: [], error: null } as any;
    if (attErr) return res.status(500).json({ ok: false, error: attErr.message });

    const { data: sharedData, error: shErr } = attemptIds.length
      ? await supabaseAdmin
          .from("training_attempt_interpretations")
          .select("attempt_id")
          .in("attempt_id", attemptIds)
          .eq("kind", "shared")
      : { data: [], error: null } as any;
    if (shErr) return res.status(500).json({ ok: false, error: shErr.message });

    const sharedSet = new Set((sharedData ?? []).map((r: any) => String(r.attempt_id)));

    const attemptById = new Map<string, any>();
    for (const a of attemptsData ?? []) attemptById.set(String((a as any).id), a);

    const cells: Record<string, any> = {};
    for (const p of progressData ?? []) {
      const key = `${p.user_id}:${p.test_slug}`;
      const done = !!p.completed_at && !!p.attempt_id;
      const started = !!p.started_at && !p.completed_at;
      const attempt = p.attempt_id ? attemptById.get(String(p.attempt_id)) : null;
      const mini = attempt?.result ? miniFromResult(attempt.result) : "";
      cells[key] = {
        status: done ? "done" : started ? "started" : "none",
        attempt_id: p.attempt_id || null,
        shared: p.attempt_id ? sharedSet.has(String(p.attempt_id)) : false,
        mini,
      };
    }

    return res.status(200).json({
      ok: true,
      room,
      members,
      room_tests: roomTests,
      enabled_test_slugs: enabledSlugs,
      progress: progressData ?? [],
      cells,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Dashboard failed" });
  }
}
