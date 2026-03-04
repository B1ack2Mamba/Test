import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";

/**
 * Room-level settings.
 * Currently supported:
 * - participants_can_see_digits: show numeric results to participants in "Мои результаты" (training mode)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  // Use `any` to avoid build-time GenericStringError when local Supabase types
  // are out of date with DB schema.
  const sb: any = supabaseAdmin as any;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { room_id, participants_can_see_digits } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  const flag = Boolean(participants_can_see_digits);

  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  // Ownership check
  const { data: room, error: roomErr } = await sb
    .from("training_rooms")
    .select("id,created_by")
    .eq("id", roomId)
    .maybeSingle();

  if (roomErr) return res.status(500).json({ ok: false, error: roomErr.message });
  if (!room) return res.status(404).json({ ok: false, error: "Комната не найдена" });
  if (room.created_by && room.created_by !== user.id) return res.status(403).json({ ok: false, error: "Forbidden" });

  // Update (column may be missing if migration not applied)
  const { data, error } = await sb
    .from("training_rooms")
    .update({ participants_can_see_digits: flag } as any)
    .eq("id", roomId)
    .select("id,participants_can_see_digits" as any)
    .single();

  if (error) {
    if (/participants_can_see_digits/i.test(error.message)) {
      return res.status(400).json({
        ok: false,
        error:
          "В базе нет поля participants_can_see_digits. Выполните SQL миграцию supabase/training_rooms_digits_mode.sql и повторите.",
      });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, settings: data });
}
