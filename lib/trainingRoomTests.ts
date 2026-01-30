import type { SupabaseClient } from "@supabase/supabase-js";

export type RoomTestRow = {
  room_id: string;
  test_slug: string;
  is_enabled: boolean;
  sort_order: number;
  required: boolean;
  deadline_at: string | null;
};

async function fetchPublishedTestSlugs(supabaseAdmin: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("tests")
    .select("slug")
    .eq("is_published", true)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r: any) => String(r.slug));
}

/**
 * Ensure training_room_tests rows exist for all published tests.
 * - If room has zero rows -> initialize with all published tests enabled and ordered.
 * - If new tests appear -> append them.
 * - If tests were removed -> delete stale rows.
 */
export async function ensureRoomTests(supabaseAdmin: SupabaseClient, roomId: string): Promise<RoomTestRow[]> {
  const published = await fetchPublishedTestSlugs(supabaseAdmin);

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("training_room_tests")
    .select("room_id,test_slug,is_enabled,sort_order,required,deadline_at")
    .eq("room_id", roomId)
    .order("sort_order", { ascending: true });

  if (exErr) throw exErr;

  const rows = (existing ?? []) as any[];
  const existingSlugs = new Set(rows.map((r) => String(r.test_slug)));

  // init empty
  if (rows.length === 0) {
    const inserts = published.map((slug, i) => ({
      room_id: roomId,
      test_slug: slug,
      is_enabled: true,
      sort_order: i,
      required: false,
      deadline_at: null,
    }));
    if (inserts.length) {
      const { error: insErr } = await supabaseAdmin.from("training_room_tests").insert(inserts);
      if (insErr) throw insErr;
    }
  } else {
    // delete stale rows
    const publishedSet = new Set(published);
    const stale = rows.filter((r) => !publishedSet.has(String(r.test_slug))).map((r) => String(r.test_slug));
    if (stale.length) {
      const { error: delErr } = await supabaseAdmin
        .from("training_room_tests")
        .delete()
        .eq("room_id", roomId)
        .in("test_slug", stale);
      if (delErr) throw delErr;
    }

    // append missing tests
    const missing = published.filter((s) => !existingSlugs.has(s));
    if (missing.length) {
      const maxOrder = rows.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0);
      const inserts = missing.map((slug, i) => ({
        room_id: roomId,
        test_slug: slug,
        is_enabled: true,
        sort_order: maxOrder + 1 + i,
        required: false,
        deadline_at: null,
      }));
      const { error: insErr } = await supabaseAdmin.from("training_room_tests").insert(inserts);
      if (insErr) throw insErr;
    }
  }

  // return current rows (sorted)
  const { data: after, error: aftErr } = await supabaseAdmin
    .from("training_room_tests")
    .select("room_id,test_slug,is_enabled,sort_order,required,deadline_at")
    .eq("room_id", roomId)
    .order("sort_order", { ascending: true });
  if (aftErr) throw aftErr;
  return (after ?? []) as any;
}

export function sortRoomTests(rows: RoomTestRow[]) {
  return [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export function enabledRoomTests(rows: RoomTestRow[]) {
  return sortRoomTests(rows).filter((r) => !!r.is_enabled);
}
