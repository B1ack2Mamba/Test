import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { ensureRoomTests, sortRoomTests, RoomTestRow } from "@/lib/trainingRoomTests";
import { isSpecialistUser } from "@/lib/specialist";

type IncomingRow = Partial<Omit<RoomTestRow, "room_id">> & { test_slug: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { room_id, room_tests } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });
  const list = (Array.isArray(room_tests) ? room_tests : []) as IncomingRow[];
  if (!list.length) return res.status(400).json({ ok: false, error: "room_tests is required" });

  // must be a specialist member of the room
  const { data: member } = await supabaseAdmin
    .from("training_room_members")
    .select("role")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member || member.role !== "specialist") return res.status(403).json({ ok: false, error: "Forbidden" });

  try {
    const baseline = await ensureRoomTests(supabaseAdmin as any, roomId);
    const baselineSlugs = new Set(baseline.map((r) => String(r.test_slug)));

    // Normalize incoming
    const incomingMap = new Map<string, IncomingRow>();
    for (const r of list) {
      const slug = String((r as any)?.test_slug || "").trim();
      if (!slug || !baselineSlugs.has(slug)) continue;
      incomingMap.set(slug, r);
    }

    const next: RoomTestRow[] = sortRoomTests(
      baseline.map((r) => {
        const inc = incomingMap.get(String(r.test_slug));
        const sort_order = Number.isFinite(Number((inc as any)?.sort_order)) ? Number((inc as any).sort_order) : r.sort_order;
        return {
          room_id: roomId,
          test_slug: String(r.test_slug),
          is_enabled: typeof (inc as any)?.is_enabled === "boolean" ? !!(inc as any).is_enabled : !!r.is_enabled,
          sort_order,
          required: typeof (inc as any)?.required === "boolean" ? !!(inc as any).required : !!r.required,
          deadline_at: (inc as any)?.deadline_at === null || typeof (inc as any)?.deadline_at === "string" ? (inc as any).deadline_at : r.deadline_at,
        };
      })
    );

    const { error: upErr } = await supabaseAdmin
      .from("training_room_tests")
      .upsert(next, { onConflict: "room_id,test_slug" });

    if (upErr) return res.status(500).json({ ok: false, error: upErr.message });

    const refreshed = await ensureRoomTests(supabaseAdmin as any, roomId);
    return res.status(200).json({ ok: true, room_tests: refreshed });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to save room tests" });
  }
}
