import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { setNoStore } from "@/lib/apiHardening";

const TASK_SELECT =
  "id,chat_id,assistant_message_id,specialist_user_id,provider,model,response_id,status,request_messages,result_text,error_text,started_at,finished_at,created_at,updated_at";
const TOKEN_LIMIT_MESSAGE = "Не хватило лимита токенов. Увеличьте количество токенов справа и повторите запрос.";

async function updateTranscriptAssistant(auth: Awaited<ReturnType<typeof requireUser>>, args: { chatId?: string | null; messageId?: string | null; patch: Record<string, any> }) {
  if (!auth || !args.chatId || !args.messageId) return;
  const { data: chat } = await auth.supabaseAdmin
    .from("specialist_ai_chats")
    .select("id,transcript")
    .eq("id", args.chatId)
    .eq("specialist_user_id", auth.user.id)
    .maybeSingle();
  const transcript = Array.isArray((chat as any)?.transcript) ? (chat as any).transcript : [];
  if (!transcript.length) return;
  const next = transcript.map((m: any) => (m?.id === args.messageId ? { ...m, ...args.patch, updated_at: new Date().toISOString() } : m));
  await auth.supabaseAdmin
    .from("specialist_ai_chats")
    .update({ transcript: next, updated_at: new Date().toISOString() })
    .eq("id", args.chatId)
    .eq("specialist_user_id", auth.user.id);
}

function extractOpenAIText(json: any): string {
  if (typeof json?.output_text === "string" && json.output_text.trim()) return json.output_text.trim();
  const output = Array.isArray(json?.output) ? json.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") chunks.push(part.text);
      if (typeof part?.content === "string") chunks.push(part.content);
    }
  }
  return chunks.join("").trim();
}

function isTokenLimitError(input: any) {
  const text = String(input || "").toLowerCase();
  return /max[_\s-]?tokens|max[_\s-]?output[_\s-]?tokens|token limit|context length|finish_reason[^\n]*length|output limit/.test(text);
}

function normalizeAiErrorMessage(input: any) {
  return isTokenLimitError(input) ? TOKEN_LIMIT_MESSAGE : String(input || "OpenAI response did not complete");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).json({ ok: false, error: "OPENAI_API_KEY is missing" });

  const taskId = String(req.query.task_id || "").trim();
  let task: any = null;
  let responseId = String(req.query.response_id || "").trim();

  if (taskId) {
    const { data, error } = await auth.supabaseAdmin
      .from("specialist_ai_chat_tasks")
      .select(TASK_SELECT)
      .eq("id", taskId)
      .eq("specialist_user_id", auth.user.id)
      .maybeSingle();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!data) return res.status(404).json({ ok: false, error: "Task not found" });
    task = data;
    responseId = String(data.response_id || "");
    if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
      return res.status(200).json({
        ok: true,
        done: data.status === "completed",
        status: data.status,
        text: data.result_text || "",
        error: data.error_text || "",
        task: data,
      });
    }
  }

  if (!responseId || !/^resp_[A-Za-z0-9_-]+$/.test(responseId)) {
    return res.status(400).json({ ok: false, error: "response_id is required" });
  }

  const response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(responseId)}`, {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) return res.status(response.status).json({ ok: false, error: normalizeAiErrorMessage(json?.error?.message || `OpenAI error ${response.status}`) });

  const status = String(json?.status || "");
  if (status === "queued" || status === "in_progress") {
    if (task) {
      const { data: updated } = await auth.supabaseAdmin
        .from("specialist_ai_chat_tasks")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", task.id)
        .eq("specialist_user_id", auth.user.id)
        .select(TASK_SELECT)
        .maybeSingle();
      task = updated || task;
      if (task?.assistant_message_id) {
        await auth.supabaseAdmin
          .from("specialist_ai_chat_messages")
          .update({ status, content: `OpenAI обрабатывает задачу. Статус: ${status}.`, updated_at: new Date().toISOString() })
          .eq("id", task.assistant_message_id)
          .eq("specialist_user_id", auth.user.id);
        await updateTranscriptAssistant(auth, {
          chatId: task.chat_id,
          messageId: task.assistant_message_id,
          patch: { status, content: `OpenAI обрабатывает задачу. Статус: ${status}.` },
        });
      }
    }
    return res.status(200).json({ ok: true, done: false, status, task });
  }
  if (status !== "completed") {
    const errorText = normalizeAiErrorMessage(json?.error?.message || json?.incomplete_details?.reason || "OpenAI response did not complete");
    if (task) {
      const { data: updated } = await auth.supabaseAdmin
        .from("specialist_ai_chat_tasks")
        .update({ status: "failed", error_text: errorText, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", task.id)
        .eq("specialist_user_id", auth.user.id)
        .select(TASK_SELECT)
        .maybeSingle();
      task = updated || task;
      if (task?.assistant_message_id) {
        await auth.supabaseAdmin
          .from("specialist_ai_chat_messages")
          .update({ status: "failed", content: errorText, updated_at: new Date().toISOString() })
          .eq("id", task.assistant_message_id)
          .eq("specialist_user_id", auth.user.id);
        await updateTranscriptAssistant(auth, {
          chatId: task.chat_id,
          messageId: task.assistant_message_id,
          patch: { status: "failed", content: errorText },
        });
      }
    }
    return res.status(200).json({ ok: true, done: true, status: "failed", error: errorText, task });
  }

  const text = extractOpenAIText(json);
  if (task) {
    const finishedAt = new Date().toISOString();
    const durationMs = task.started_at ? Math.max(0, Date.now() - Date.parse(task.started_at)) : null;
    const { data: updated } = await auth.supabaseAdmin
      .from("specialist_ai_chat_tasks")
      .update({ status: "completed", result_text: text, finished_at: finishedAt, updated_at: finishedAt })
      .eq("id", task.id)
      .eq("specialist_user_id", auth.user.id)
      .select(TASK_SELECT)
      .maybeSingle();
    task = updated || task;
    if (task?.assistant_message_id) {
      await auth.supabaseAdmin
        .from("specialist_ai_chat_messages")
        .update({
          status: "completed",
          content: text,
          duration_ms: durationMs,
          updated_at: finishedAt,
        })
        .eq("id", task.assistant_message_id)
        .eq("specialist_user_id", auth.user.id);
      await updateTranscriptAssistant(auth, {
        chatId: task.chat_id,
        messageId: task.assistant_message_id,
        patch: { status: "completed", content: text, duration_ms: durationMs },
      });
    }
  }
  return res.status(200).json({ ok: true, done: true, status: "completed", text, task });
}
