import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

function getBearerToken(req: NextApiRequest): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export async function assertAdmin(req: NextApiRequest, res: NextApiResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    res
      .status(500)
      .json({ ok: false, error: "Server env missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" });
    return null;
  }

  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    return null;
  }

  const adminEmail = (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "storyguild9@gmail.com").toLowerCase();
  const supabase = createClient(url, publishableKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    res.status(401).json({ ok: false, error: "Invalid session" });
    return null;
  }

  const email = (data.user.email || "").toLowerCase();
  if (!email || email !== adminEmail) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return null;
  }

  return { user: data.user, token };
}
