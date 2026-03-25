import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { retryTransientApi, setNoStore } from "@/lib/apiHardening";
import { enabledRoomTests, getRoomTestsSafe } from "@/lib/trainingRoomTests";
import { isSpecialistUser } from "@/lib/specialist";
import type { ScoreResult } from "@/lib/score";

type TimingMap = Record<string, number>;

function markSince(start: number) {
  return Date.now() - start;
}

function setServerTiming(res: NextApiResponse, timings: TimingMap) {
  try {
    const entries = Object.entries(timings)
      .filter(([, v]) => Number.isFinite(v))
      .map(([k, v]) => `${k};dur=${Math.max(0, Math.round(Number(v)))}`);
    if (entries.length) res.setHeader("Server-Timing", entries.join(", "));
  } catch {}
}

function miniFromResult(result: any): string {
  const r = result as ScoreResult;
  if (!r || typeof r !== "object") return "";

  const sorted = Array.isArray(r.ranked) ? [...r.ranked].sort((a: any, b: any) => (Number(b?.percent) || 0) - (Number(a?.percent) || 0)) : [];

  if (r.kind === "color_types_v1") {
    const g = r.counts?.green ?? 0;
    const red = r.counts?.red ?? 0;
    const b = r.counts?.blue ?? 0;
    const top = sorted[0]?.style ? String(sorted[0].style) : "";
    return `З${g} К${red} С${b}${top ? ` · ${top}` : ""}`;
  }
  if (sorted.length) {
    const a = sorted[0];
    const b = sorted[1];
    const denomFor = (row: any) => {
      if (!row) return null;
      if (r.kind === "forced_pair_v1" || r.kind === "color_types_v1" || r.kind === "usk_v1" || r.kind === "time_management_v1" || r.kind === "learning_typology_v1") return r.total;
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

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getAuthorizedRoom(req: NextApiRequest, res: NextApiResponse, roomId: string) {
  const timings: TimingMap = {};
  const authStarted = Date.now();
  const auth = await requireUser(req, res, { requireEmail: true });
  timings.auth = markSince(authStarted);
  if (!auth) return null;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return null;
  }

  const sb: any = supabaseAdmin as any;
  const selectRoom = async (withPrompt: boolean) => {
    const sel = withPrompt
      ? "id,name,created_by_email,is_active,created_at,analysis_prompt,group_analysis_prompt"
      : "id,name,created_by_email,is_active,created_at";
    const started = Date.now();
    const out = await retryTransientApi<any>(
      () => sb.from("training_rooms").select(sel).eq("id", roomId).maybeSingle(),
      { attempts: 1, delayMs: 0 }
    );
    timings[withPrompt ? "room_select" : "room_select_fallback"] = markSince(started);
    return out;
  };

  const memberStarted = Date.now();
  const roomStarted = Date.now();
  const [memberResp, firstRoomResp] = await Promise.all([
    retryTransientApi<any>(
      () => supabaseAdmin
        .from("training_room_members")
        .select("role")
        .eq("room_id", roomId)
        .eq("user_id", user.id)
        .maybeSingle(),
      { attempts: 1, delayMs: 0 }
    ).finally(() => { timings.member_check = markSince(memberStarted); }),
    selectRoom(true).finally(() => { timings.room_check = markSince(roomStarted); }),
  ]);

  const { data: member, error: memErr } = memberResp;
  if (memErr || !member || member.role !== "specialist") {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return null;
  }

  let { data: room, error: roomErr } = firstRoomResp;
  if (roomErr && /(analysis_prompt|group_analysis_prompt)/i.test(roomErr.message || "")) {
    ({ data: room, error: roomErr } = await selectRoom(false));
  }
  if (roomErr || !room) {
    res.status(404).json({ ok: false, error: "Room not found" });
    return null;
  }

  return { user, supabaseAdmin, room, authTimings: timings };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const roomId = String(req.query.room_id || "").trim();
  const mode = String(req.query.mode || "full").trim().toLowerCase();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  const requestStarted = Date.now();
  const debugTimingsWanted = String(req.query.debug || "") === "1" || process.env.NODE_ENV !== "production";
  const ctx = await getAuthorizedRoom(req, res, roomId);
  if (!ctx) return;
  const { supabaseAdmin, room, authTimings } = ctx;
  const timings: TimingMap = { ...(authTimings || {}) };

  try {
    const roomTestsStarted = Date.now();
    const roomTests = await getRoomTestsSafe(supabaseAdmin as any, roomId);
    timings.room_tests = markSince(roomTestsStarted);
    const enabled = enabledRoomTests(roomTests);
    const enabledSlugs = enabled.map((r) => r.test_slug);

    if (mode === "shell") {
      timings.total = markSince(requestStarted);
      setServerTiming(res, timings);
      return res.status(200).json({
        ok: true,
        room,
        room_tests: roomTests,
        enabled_test_slugs: enabledSlugs,
        ...(debugTimingsWanted ? { _timings: timings } : {}),
      });
    }

    const membersStarted = Date.now();
    const progressStarted = Date.now();
    const [membersResp, progressResp] = await Promise.all([
      retryTransientApi<any>(
        () => supabaseAdmin
          .from("training_room_members")
          .select("id,user_id,display_name,role,joined_at,last_seen")
          .eq("room_id", roomId)
          .order("joined_at", { ascending: true }),
        { attempts: 1, delayMs: 0 }
      ).finally(() => { timings.members = markSince(membersStarted); }),
      retryTransientApi<any>(
        () => supabaseAdmin
          .from("training_progress")
          .select("room_id,user_id,test_slug,started_at,completed_at,attempt_id")
          .eq("room_id", roomId)
          .in("test_slug", enabledSlugs.length ? enabledSlugs : ["__none__"]),
        { attempts: 1, delayMs: 0 }
      ).finally(() => { timings.progress = markSince(progressStarted); }),
    ]);

    const { data: membersData, error: membersErr } = membersResp;
    if (membersErr) return res.status(500).json({ ok: false, error: membersErr.message });

    const now = Date.now();
    const onlineWindowMs = 60_000;
    const members = (membersData ?? []).map((m: any) => ({
      ...m,
      online: m.last_seen ? now - new Date(m.last_seen).getTime() < onlineWindowMs : false,
    }));

    const { data: progressData, error: progErr } = progressResp;
    if (progErr) return res.status(500).json({ ok: false, error: progErr.message });

    const attemptIds = Array.from(new Set((progressData ?? [])
      .map((p: any) => p.attempt_id)
      .filter(Boolean))) as string[];

    const attemptsStarted = Date.now();
    const sharedStarted = Date.now();
    const [attemptsResp, sharedResp] = attemptIds.length
      ? await Promise.all([
          retryTransientApi<any>(
            () => supabaseAdmin
              .from("training_attempts")
              .select("id,result")
              .in("id", attemptIds),
            { attempts: 1, delayMs: 0 }
          ).finally(() => { timings.attempts = markSince(attemptsStarted); }),
          withTimeout(
            retryTransientApi<any>(
              () => supabaseAdmin
                .from("training_attempt_interpretations")
                .select("attempt_id")
                .in("attempt_id", attemptIds)
                .eq("kind", "shared"),
              { attempts: 1, delayMs: 0 }
            ).finally(() => { timings.shared = markSince(sharedStarted); }),
            1200
          ),
        ])
      : ([{ data: [], error: null }, { data: [], error: null }] as any);

    const { data: attemptsData, error: attErr } = attemptsResp;
    if (attErr) return res.status(500).json({ ok: false, error: attErr.message });

    const sharedData = sharedResp && typeof sharedResp === "object" ? (sharedResp as any).data : [];
    const shErr = sharedResp && typeof sharedResp === "object" ? (sharedResp as any).error : null;
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

    const buildStarted = Date.now();
    const participantCount = members.filter((m: any) => m.role === "participant").length;
    const completedCount = Array.from(new Set((progressData ?? []).filter((p: any) => !!p.completed_at).map((p: any) => String(p.user_id)))).length;
    timings.build = markSince(buildStarted);
    timings.total = markSince(requestStarted);
    setServerTiming(res, timings);

    return res.status(200).json({
      ok: true,
      room,
      room_tests: roomTests,
      enabled_test_slugs: enabledSlugs,
      members,
      progress: progressData ?? [],
      cells,
      stats: {
        participant_count: participantCount,
        completed_participant_count: completedCount,
        attempt_count: attemptIds.length,
      },
      ...(debugTimingsWanted ? { _timings: timings } : {}),
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Dashboard failed" });
  }
}
