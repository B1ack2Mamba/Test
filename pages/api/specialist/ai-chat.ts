import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { setNoStore } from "@/lib/apiHardening";
import { appendAttachmentsToLastUserMessage } from "@/lib/aiChatFiles";

type ChatProvider = "openai" | "deepseek";
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const OPENAI_MODELS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5", "gpt-5.5-pro"];
const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];
const TASK_SELECT =
  "id,chat_id,assistant_message_id,provider,model,response_id,status,request_messages,result_text,error_text,started_at,finished_at,created_at,updated_at";
const CHAT_SELECT = "id,provider,title,last_provider,last_model,last_user_message,transcript,created_at,updated_at";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "45mb",
    },
  },
};

function normalizeDeepseekBaseUrl(input?: string) {
  return String(input || "https://api.deepseek.com")
    .trim()
    .replace(/\/$/, "")
    .replace(/\/chat\/completions$/i, "");
}

function cleanMessages(input: any): ChatMessage[] {
  const raw = Array.isArray(input) ? input : [];
  return raw
    .map((m: any): ChatMessage => ({
      role: m?.role === "assistant" ? "assistant" : "user",
      content: String(m?.content || "").trim(),
    }))
    .filter((m) => m.content);
}

function titleFromMessage(input: string) {
  const text = String(input || "").replace(/\s+/g, " ").trim();
  if (!text) return "Новый чат";
  return text.length > 64 ? `${text.slice(0, 64).trim()}...` : text;
}

async function getOrCreateChat(auth: Awaited<ReturnType<typeof requireUser>>, chatId: string, provider: ChatProvider, firstUserText: string) {
  if (!auth) throw new Error("Unauthorized");
  if (chatId) {
    const { data, error } = await auth.supabaseAdmin
      .from("specialist_ai_chats")
      .select(CHAT_SELECT)
      .eq("id", chatId)
      .eq("specialist_user_id", auth.user.id)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Chat not found");
    return data;
  }

  const { data, error } = await auth.supabaseAdmin
    .from("specialist_ai_chats")
    .insert({
      specialist_user_id: auth.user.id,
      provider,
      last_provider: provider,
      title: titleFromMessage(firstUserText),
      last_user_message: firstUserText,
      updated_at: new Date().toISOString(),
    })
    .select(CHAT_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateChatSummary(auth: Awaited<ReturnType<typeof requireUser>>, args: { chatId: string; provider: ChatProvider; model: string; lastUser: string }) {
  if (!auth) return;
  await auth.supabaseAdmin
    .from("specialist_ai_chats")
    .update({
      last_provider: args.provider,
      last_model: args.model,
      last_user_message: args.lastUser,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.chatId)
    .eq("specialist_user_id", auth.user.id);
}

function transcriptFromChat(chat: any): any[] {
  return Array.isArray(chat?.transcript) ? chat.transcript : [];
}

function transcriptUserMessage(message: any) {
  return {
    id: message.id,
    chat_id: message.chat_id,
    role: "user",
    content: message.content,
    status: "completed",
    metadata: message.metadata || {},
    created_at: message.created_at,
    updated_at: message.updated_at,
  };
}

function transcriptAssistantMessage(message: any, taskId?: string | null) {
  return {
    id: message.id,
    chat_id: message.chat_id,
    role: "assistant",
    content: message.content,
    provider: message.provider,
    model: message.model,
    task_id: taskId || message.task_id || null,
    status: message.status || "completed",
    duration_ms: message.duration_ms || null,
    metadata: message.metadata || {},
    created_at: message.created_at,
    updated_at: message.updated_at,
  };
}

async function saveChatTranscript(auth: Awaited<ReturnType<typeof requireUser>>, chatId: string, transcript: any[]) {
  if (!auth) return;
  await auth.supabaseAdmin
    .from("specialist_ai_chats")
    .update({ transcript, updated_at: new Date().toISOString() })
    .eq("id", chatId)
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

function extractDeepseekText(json: any): string {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

function transcriptForOpenAI(messages: ChatMessage[]) {
  return messages.map((m) => `${m.role === "assistant" ? "Ассистент" : "Пользователь"}:\n${m.content}`).join("\n\n");
}

async function callOpenAI(args: { model: string; messages: ChatMessage[]; temperature: number; maxOutputTokens: number }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is missing");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: args.model,
      instructions:
        "Ты встроенный помощник специалиста платформы психологического тестирования. Отвечай по-русски, структурно и практически. Не ставь медицинские диагнозы и не выдумывай данные.",
      input: transcriptForOpenAI(args.messages),
      background: true,
      max_output_tokens: args.maxOutputTokens,
    }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(json?.error?.message || `OpenAI error ${response.status}`));
  if (json?.id && (json?.status === "queued" || json?.status === "in_progress")) {
    return { responseId: String(json.id), status: String(json.status) };
  }
  const text = extractOpenAIText(json);
  if (!text) throw new Error("OpenAI ответил без текста");
  return { text };
}

async function callDeepseek(args: { model: string; messages: ChatMessage[]; temperature: number; maxOutputTokens: number }) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is missing");
  const base = normalizeDeepseekBaseUrl(process.env.DEEPSEEK_BASE_URL);

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        {
          role: "system",
          content:
            "Ты встроенный помощник специалиста платформы психологического тестирования. Отвечай по-русски, структурно и практически. Не ставь медицинские диагнозы и не выдумывай данные.",
        },
        ...args.messages,
      ],
      max_tokens: args.maxOutputTokens,
      temperature: args.temperature,
    }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(json?.error?.message || `DeepSeek error ${response.status}`));
  const text = extractDeepseekText(json);
  if (!text) throw new Error("DeepSeek ответил без текста");
  return text;
}

function deepseekPayload(args: { model: string; messages: ChatMessage[]; temperature: number; maxOutputTokens: number; stream?: boolean }) {
  return {
    model: args.model,
    messages: [
      {
        role: "system",
        content:
          "Ты встроенный помощник специалиста платформы психологического тестирования. Отвечай по-русски, структурно и практически. Не ставь медицинские диагнозы и не выдумывай данные.",
      },
      ...args.messages,
    ],
    max_tokens: args.maxOutputTokens,
    temperature: args.temperature,
    stream: Boolean(args.stream),
  };
}

function writeStreamEvent(res: NextApiResponse, event: Record<string, any>) {
  res.write(`${JSON.stringify(event)}\n`);
}

async function callDeepseekStream(args: {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is missing");
  const base = normalizeDeepseekBaseUrl(process.env.DEEPSEEK_BASE_URL);

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(deepseekPayload({ ...args, stream: true })),
    signal: args.signal,
  });

  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new Error(String(json?.error?.message || `DeepSeek error ${response.status}`));
  }
  if (!response.body) throw new Error("DeepSeek stream is empty");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const json = JSON.parse(data);
      const delta = json?.choices?.[0]?.delta?.content || "";
      if (delta) {
        text += delta;
        args.onDelta(delta);
      }
    }
  }

  if (!text.trim()) throw new Error("DeepSeek ответил без текста");
  return text.trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const provider = String(req.body?.provider || "").trim() as ChatProvider;
  const model = String(req.body?.model || "").trim();
  let messages = cleanMessages(req.body?.messages);
  const chatId = String(req.body?.chat_id || "").trim();
  const temperature = Math.min(1.5, Math.max(0, Number(req.body?.temperature ?? 0.3)));
  const maxOutputTokens = Math.min(12000, Math.max(256, Number(req.body?.max_output_tokens ?? 3000)));

  if (provider !== "openai" && provider !== "deepseek") {
    return res.status(400).json({ ok: false, error: "Unknown provider" });
  }
  if (!messages.length) return res.status(400).json({ ok: false, error: "Message is required" });
  if (provider === "openai" && !OPENAI_MODELS.includes(model)) {
    return res.status(400).json({ ok: false, error: "Unknown OpenAI model" });
  }
  if (provider === "deepseek" && !DEEPSEEK_MODELS.includes(model)) {
    return res.status(400).json({ ok: false, error: "Unknown DeepSeek model" });
  }

  try {
    const originalLastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const chat = await getOrCreateChat(auth, chatId, provider, originalLastUser);
    const withFiles = await appendAttachmentsToLastUserMessage(messages, req.body?.files, req.body?.platform_context);
    messages = withFiles.messages;
    const savedLastUser = [...messages].reverse().find((m) => m.role === "user")?.content || originalLastUser;
    const { data: userMessage, error: userMessageError } = await auth.supabaseAdmin
      .from("specialist_ai_chat_messages")
      .insert({
        chat_id: chat.id,
        specialist_user_id: auth.user.id,
        role: "user",
        content: savedLastUser,
        metadata: {
          files: withFiles.files,
          platform_context_chars: withFiles.platformContextChars,
          platform_context_truncated: withFiles.platformContextTruncated,
        },
      })
      .select("id,chat_id,role,content,provider,model,task_id,status,duration_ms,metadata,created_at,updated_at")
      .single();
    if (userMessageError) throw new Error(userMessageError.message);
    await updateChatSummary(auth, { chatId: chat.id, provider, model, lastUser: savedLastUser });
    const baseTranscript = [...transcriptFromChat(chat), transcriptUserMessage(userMessage)];

    if (provider === "openai") {
      const started = Date.now();
      const result = await callOpenAI({ model, messages, temperature, maxOutputTokens });
      if ("responseId" in result) {
        const { data: assistantMessage, error: assistantMessageError } = await auth.supabaseAdmin
          .from("specialist_ai_chat_messages")
          .insert({
            chat_id: chat.id,
            specialist_user_id: auth.user.id,
            role: "assistant",
            content: `OpenAI обрабатывает задачу. Статус: ${result.status || "queued"}.`,
            provider,
            model,
            status: result.status || "queued",
          })
          .select("id,chat_id,role,content,provider,model,task_id,status,duration_ms,metadata,created_at,updated_at")
          .single();
        if (assistantMessageError) throw new Error(assistantMessageError.message);

        const { data: task, error } = await auth.supabaseAdmin
          .from("specialist_ai_chat_tasks")
          .insert({
            specialist_user_id: auth.user.id,
            chat_id: chat.id,
            assistant_message_id: assistantMessage.id,
            provider,
            model,
            response_id: result.responseId,
            status: result.status || "queued",
            request_messages: messages,
            temperature,
            max_output_tokens: maxOutputTokens,
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select(TASK_SELECT)
          .single();
        if (error) {
          return res.status(500).json({
            ok: false,
            error: /specialist_ai_chat_tasks/i.test(error.message || "")
              ? "В базе нет таблицы specialist_ai_chat_tasks. Выполните SQL миграцию supabase/specialist_ai_chat_tasks.sql."
              : error.message,
          });
        }
        await auth.supabaseAdmin
          .from("specialist_ai_chat_messages")
          .update({ task_id: task.id, updated_at: new Date().toISOString() })
          .eq("id", assistantMessage.id)
          .eq("specialist_user_id", auth.user.id);
        const savedAssistantMessage = { ...assistantMessage, task_id: task.id };
        await saveChatTranscript(auth, chat.id, [...baseTranscript, transcriptAssistantMessage(savedAssistantMessage, task.id)]);
        return res.status(200).json({ ok: true, provider, model, chat, userMessage, assistantMessage: { ...assistantMessage, task_id: task.id }, ...result, task });
      }
      const durationMs = Date.now() - started;
      const { data: assistantMessage, error: assistantMessageError } = await auth.supabaseAdmin
        .from("specialist_ai_chat_messages")
        .insert({
          chat_id: chat.id,
          specialist_user_id: auth.user.id,
          role: "assistant",
          content: result.text || "",
          provider,
          model,
          status: "completed",
          duration_ms: durationMs,
        })
        .select("id,chat_id,role,content,provider,model,task_id,status,duration_ms,metadata,created_at,updated_at")
        .single();
      if (assistantMessageError) throw new Error(assistantMessageError.message);
      const { data: task, error: taskError } = await auth.supabaseAdmin
        .from("specialist_ai_chat_tasks")
        .insert({
          specialist_user_id: auth.user.id,
          chat_id: chat.id,
          assistant_message_id: assistantMessage.id,
          provider,
          model,
          status: "completed",
          request_messages: messages,
          result_text: result.text || "",
          temperature,
          max_output_tokens: maxOutputTokens,
          started_at: new Date(started).toISOString(),
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select(TASK_SELECT)
        .single();
      if (taskError) throw new Error(taskError.message);
      await auth.supabaseAdmin
        .from("specialist_ai_chat_messages")
        .update({ task_id: task.id, updated_at: new Date().toISOString() })
        .eq("id", assistantMessage.id)
        .eq("specialist_user_id", auth.user.id);
      const savedAssistantMessage = { ...assistantMessage, task_id: task.id };
      await saveChatTranscript(auth, chat.id, [...baseTranscript, transcriptAssistantMessage(savedAssistantMessage, task.id)]);
      return res.status(200).json({ ok: true, provider, model, chat, userMessage, assistantMessage: { ...assistantMessage, task_id: task.id }, task, ...result });
    }
    if (req.body?.stream === true) {
      const started = Date.now();
      const controller = new AbortController();
      req.on("close", () => controller.abort());
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      writeStreamEvent(res, { type: "meta", ok: true, provider, model, chat, userMessage });

      try {
        const text = await callDeepseekStream({
          model,
          messages,
          temperature,
          maxOutputTokens,
          signal: controller.signal,
          onDelta: (delta) => writeStreamEvent(res, { type: "delta", text: delta }),
        });
        const durationMs = Date.now() - started;
        const { data: assistantMessage, error: assistantMessageError } = await auth.supabaseAdmin
          .from("specialist_ai_chat_messages")
          .insert({
            chat_id: chat.id,
            specialist_user_id: auth.user.id,
            role: "assistant",
            content: text,
            provider,
            model,
            status: "completed",
            duration_ms: durationMs,
          })
          .select("id,chat_id,role,content,provider,model,task_id,status,duration_ms,metadata,created_at,updated_at")
          .single();
        if (assistantMessageError) throw new Error(assistantMessageError.message);
        const { data: task, error: taskError } = await auth.supabaseAdmin
          .from("specialist_ai_chat_tasks")
          .insert({
            specialist_user_id: auth.user.id,
            chat_id: chat.id,
            assistant_message_id: assistantMessage.id,
            provider,
            model,
            status: "completed",
            request_messages: messages,
            result_text: text,
            temperature,
            max_output_tokens: maxOutputTokens,
            started_at: new Date(started).toISOString(),
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select(TASK_SELECT)
          .single();
        if (taskError) throw new Error(taskError.message);
        await auth.supabaseAdmin
          .from("specialist_ai_chat_messages")
          .update({ task_id: task.id, updated_at: new Date().toISOString() })
          .eq("id", assistantMessage.id)
          .eq("specialist_user_id", auth.user.id);
        const savedAssistantMessage = { ...assistantMessage, task_id: task.id };
        await saveChatTranscript(auth, chat.id, [...baseTranscript, transcriptAssistantMessage(savedAssistantMessage, task.id)]);
        writeStreamEvent(res, { type: "done", ok: true, text, chat, assistantMessage: { ...assistantMessage, task_id: task.id }, task });
      } catch (e: any) {
        const errorText = e?.name === "AbortError" ? "Запрос остановлен" : e?.message || "DeepSeek stream failed";
        writeStreamEvent(res, { type: "error", ok: false, error: errorText });
      } finally {
        res.end();
      }
      return;
    }

    const started = Date.now();
    const text = await callDeepseek({ model, messages, temperature, maxOutputTokens });
    const durationMs = Date.now() - started;
    const { data: assistantMessage, error: assistantMessageError } = await auth.supabaseAdmin
      .from("specialist_ai_chat_messages")
      .insert({
        chat_id: chat.id,
        specialist_user_id: auth.user.id,
        role: "assistant",
        content: text,
        provider,
        model,
        status: "completed",
        duration_ms: durationMs,
      })
      .select("id,chat_id,role,content,provider,model,task_id,status,duration_ms,metadata,created_at,updated_at")
      .single();
    if (assistantMessageError) throw new Error(assistantMessageError.message);
    const { data: task, error: taskError } = await auth.supabaseAdmin
      .from("specialist_ai_chat_tasks")
      .insert({
        specialist_user_id: auth.user.id,
        chat_id: chat.id,
        assistant_message_id: assistantMessage.id,
        provider,
        model,
        status: "completed",
        request_messages: messages,
        result_text: text,
        temperature,
        max_output_tokens: maxOutputTokens,
        started_at: new Date(started).toISOString(),
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select(TASK_SELECT)
      .single();
    if (taskError) throw new Error(taskError.message);
    await auth.supabaseAdmin
      .from("specialist_ai_chat_messages")
      .update({ task_id: task.id, updated_at: new Date().toISOString() })
      .eq("id", assistantMessage.id)
      .eq("specialist_user_id", auth.user.id);
    const savedAssistantMessage = { ...assistantMessage, task_id: task.id };
    await saveChatTranscript(auth, chat.id, [...baseTranscript, transcriptAssistantMessage(savedAssistantMessage, task.id)]);
    return res.status(200).json({ ok: true, provider, model, chat, userMessage, assistantMessage: { ...assistantMessage, task_id: task.id }, task, text });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "AI request failed" });
  }
}
