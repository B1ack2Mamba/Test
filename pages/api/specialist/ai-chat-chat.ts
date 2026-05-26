import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { setNoStore } from "@/lib/apiHardening";

const CHAT_SELECT = "id,provider,title,last_provider,last_model,last_user_message,transcript,created_at,updated_at";
const MESSAGE_SELECT = "id,chat_id,role,content,provider,model,task_id,status,duration_ms,metadata,created_at,updated_at";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const chatId = String(req.query.chat_id || "").trim();
  if (!chatId) return res.status(400).json({ ok: false, error: "chat_id is required" });

  const { data: chat, error: chatError } = await auth.supabaseAdmin
    .from("specialist_ai_chats")
    .select(CHAT_SELECT)
    .eq("id", chatId)
    .eq("specialist_user_id", auth.user.id)
    .maybeSingle();

  if (chatError) return res.status(500).json({ ok: false, error: chatError.message });
  if (!chat) return res.status(404).json({ ok: false, error: "Chat not found" });

  const transcript = Array.isArray((chat as any).transcript) ? (chat as any).transcript : [];
  if (transcript.length) return res.status(200).json({ ok: true, chat, messages: transcript });

  const { data: messages, error: messagesError } = await auth.supabaseAdmin
    .from("specialist_ai_chat_messages")
    .select(MESSAGE_SELECT)
    .eq("chat_id", chatId)
    .eq("specialist_user_id", auth.user.id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (messagesError) return res.status(500).json({ ok: false, error: messagesError.message });
  return res.status(200).json({ ok: true, chat, messages: messages || [] });
}
