import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { getActiveTrainingRoomSessionRoomIds } from "@/lib/trainingRoomServerSession";
import { setNoStore } from "@/lib/apiHardening";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;

  const { user, supabaseAdmin } = auth;

  const { data, error } = await supabaseAdmin
    .from("training_rooms")
    .select("id,name,created_at,created_by_email,is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const roomIds = (data ?? []).map((r: any) => String(r.id));
  let activeSessionRoomIds = new Set<string>();

  if (roomIds.length) {
    const state = await getActiveTrainingRoomSessionRoomIds(req, supabaseAdmin as any, user.id, roomIds);
    if (state.error) return res.status(500).json({ ok: false, error: state.error });
    activeSessionRoomIds = state.roomIds;

    if (state.tableMissing) {
      // Backward compatibility until migration is applied.
      const { data: memberships } = await supabaseAdmin
        .from("training_room_members")
        .select("room_id")
        .eq("user_id", user.id)
        .in("room_id", roomIds);
      activeSessionRoomIds = new Set((memberships ?? []).map((m: any) => String(m.room_id)));
    }
  }

  return res.status(200).json({
    ok: true,
    rooms: (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      created_at: r.created_at,
      created_by_email: r.created_by_email ?? null,
      is_joined: activeSessionRoomIds.has(String(r.id)),
    })),
  });
}
