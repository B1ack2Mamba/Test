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
 *
 * Important dev/perf behavior:
 * - FIRST read existing rows for the room.
 * - If rows already exist, return them immediately and do NOT touch `public.tests`.
 *   This keeps the specialist room fast even when remote Supabase is flaky/timeouts.
 * - Only query `public.tests` when the room has zero rows and really needs initialization.
 */
export async function ensureRoomTests(supabaseAdmin: SupabaseClient, roomId: string): Promise<RoomTestRow[]> {
  const { data: existing, error: exErr } = await supabaseAdmin
    .from("training_room_tests")
    .select("room_id,test_slug,is_enabled,sort_order,required,deadline_at")
    .eq("room_id", roomId)
    .order("sort_order", { ascending: true });

  if (exErr) throw exErr;

  const rows = (existing ?? []) as any[];
  if (rows.length > 0) return rows as any;

  // Empty room: initialize from published tests.
  const published = await fetchPublishedTestSlugs(supabaseAdmin);
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

  const { data: after, error: aftErr } = await supabaseAdmin
    .from("training_room_tests")
    .select("room_id,test_slug,is_enabled,sort_order,required,deadline_at")
    .eq("room_id", roomId)
    .order("sort_order", { ascending: true });
  if (aftErr) throw aftErr;
  return (after ?? []) as any;
}

export async function getRoomTestsSafe(supabaseAdmin: SupabaseClient, roomId: string): Promise<RoomTestRow[]> {
  try {
    return await ensureRoomTests(supabaseAdmin, roomId);
  } catch {
    const { data } = await supabaseAdmin
      .from("training_room_tests")
      .select("room_id,test_slug,is_enabled,sort_order,required,deadline_at")
      .eq("room_id", roomId)
      .order("sort_order", { ascending: true });
    return ((data ?? []) as any[]);
  }
}

export function sortRoomTests(rows: RoomTestRow[]) {
  return [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export function enabledRoomTests(rows: RoomTestRow[]) {
  return sortRoomTests(rows).filter((r) => !!r.is_enabled);
}
