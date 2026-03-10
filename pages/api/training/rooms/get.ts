import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const roomId = String(req.query.room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  // Relax typing: many projects ship with locally generated Supabase types that
  // may lag behind DB migrations. Using `any` prevents Next.js typecheck errors
  // like GenericStringError/ParserError when selecting optional columns.
  const sb: any = supabaseAdmin as any;

  const selectRoom = async (withFlag: boolean) => {
    const sel = withFlag
      ? "id,name,created_by_email,is_active,participants_can_see_digits,analysis_prompt"
      : "id,name,created_by_email,is_active,analysis_prompt";
    return await sb.from("training_rooms").select(sel).eq("id", roomId).maybeSingle();
  };

  let { data: room, error } = await selectRoom(true);
  if (error && /(participants_can_see_digits|analysis_prompt)/i.test(error.message || "")) {
    ({ data: room, error } = await selectRoom(false));
    if (error && /analysis_prompt/i.test(error.message || "")) {
      const sb: any = supabaseAdmin as any;
      ({ data: room, error } = await sb.from("training_rooms").select("id,name,created_by_email,is_active").eq("id", roomId).maybeSingle());
    }
  }

  if (error || !room) return res.status(404).json({ ok: false, error: "Room not found" });

  // check membership
  const { data: member } = await supabaseAdmin
    .from("training_room_members")
    .select("role,display_name")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();

  return res.status(200).json({
    ok: true,
    room: {
      id: room.id,
      name: room.name,
      created_by_email: room.created_by_email ?? null,
      is_active: room.is_active,
      participants_can_see_digits: Boolean((room as any)?.participants_can_see_digits),
      analysis_prompt: typeof (room as any)?.analysis_prompt === "string" ? (room as any).analysis_prompt : "",
    },
    member: member ? { role: member.role, display_name: member.display_name } : null,
  });
}
