import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  // Use `any` to avoid build-time GenericStringError when local Supabase types
  // are out of date with DB schema.
  const sb: any = supabaseAdmin as any;

  // Try to include optional column participants_can_see_digits (may be missing on older DBs).
  const trySelect = async (withFlag: boolean) => {
    const sel = withFlag ? "id,name,created_at,is_active,participants_can_see_digits" : "id,name,created_at,is_active";
    return await sb
      .from("training_rooms")
      .select(sel)
      .eq("created_by", user.id)
      .order("created_at", { ascending: false });
  };

  let { data, error } = await trySelect(true);
  if (error && /participants_can_see_digits/i.test(error.message)) {
    ({ data, error } = await trySelect(false));
  }
  if (error) return res.status(500).json({ ok: false, error: error.message });

  return res.status(200).json({ ok: true, rooms: data ?? [] });
}
