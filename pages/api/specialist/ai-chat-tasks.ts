import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { setNoStore } from "@/lib/apiHardening";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { data, error } = await auth.supabaseAdmin
    .from("specialist_ai_chat_tasks")
    .select("id,chat_id,assistant_message_id,provider,model,response_id,status,request_messages,result_text,error_text,started_at,finished_at,created_at,updated_at")
    .eq("specialist_user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return res.status(500).json({
      ok: false,
      error: /specialist_ai_chat_tasks/i.test(error.message || "")
        ? "В базе нет таблицы specialist_ai_chat_tasks. Выполните SQL миграцию supabase/specialist_ai_chat_tasks.sql."
        : error.message,
    });
  }

  return res.status(200).json({ ok: true, tasks: data || [] });
}
