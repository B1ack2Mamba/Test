import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

export type AuthedUser = {
  id: string;
  email: string | null;
};

function getBearerToken(req: NextApiRequest): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export async function requireUser(
  req: NextApiRequest,
  res: NextApiResponse,
  opts?: { requireEmail?: boolean }
): Promise<{ user: AuthedUser; token: string; supabaseAdmin: ReturnType<typeof createClient> } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    res
      .status(500)
      .json({ ok: false, error: "Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" });
    return null;
  }

  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    return null;
  }

  const supabaseAdmin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ ok: false, error: "Invalid session" });
    return null;
  }

  const user: AuthedUser = { id: data.user.id, email: data.user.email ?? null };
  if (opts?.requireEmail && !user.email) {
    res.status(400).json({ ok: false, error: "User email is missing" });
    return null;
  }

  return { user, token, supabaseAdmin };
}
