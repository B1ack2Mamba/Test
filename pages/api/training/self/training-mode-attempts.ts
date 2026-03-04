import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";

type Row = {
  attempt_id: string;
  test_slug: string;
  room_id: string;
  room_name: string | null;
  created_at: string;
  result: any;
};

/**
 * Returns user's own attempts from rooms where participants_can_see_digits=true.
 * Used to show numeric results in "Мои результаты" for training mode.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  // Use `any` to avoid build-time GenericStringError when local Supabase types
  // are out of date with DB schema.
  const sb: any = supabaseAdmin as any;

  // If migration not applied, return empty (and keep UI usable).
  // We'll detect the missing column on the join/filter.
  const { data, error } = await sb
    .from("training_attempts")
    .select("id,test_slug,room_id,created_at,result,training_rooms!inner(name,participants_can_see_digits)")
    .eq("user_id", user.id)
    .eq("training_rooms.participants_can_see_digits", true)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    if (/participants_can_see_digits/i.test(error.message)) {
      return res.status(200).json({ ok: true, attempts: [] as Row[], missing_migration: true });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }

  const rows: Row[] = (data || []).map((r: any) => ({
    attempt_id: r.id,
    test_slug: r.test_slug,
    room_id: r.room_id,
    room_name: r.training_rooms?.name ?? null,
    created_at: r.created_at,
    result: r.result,
  }));

  return res.status(200).json({ ok: true, attempts: rows });
}
