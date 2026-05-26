import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { setNoStore } from "@/lib/apiHardening";

type ChatProvider = "openai" | "deepseek";
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const OPENAI_MODELS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5", "gpt-5.5-pro"];
const DEEPSEEK_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"];

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
    .filter((m) => m.content)
    .slice(-16);
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
      temperature: args.temperature,
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const provider = String(req.body?.provider || "").trim() as ChatProvider;
  const model = String(req.body?.model || "").trim();
  const messages = cleanMessages(req.body?.messages);
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
    if (provider === "openai") {
      const result = await callOpenAI({ model, messages, temperature, maxOutputTokens });
      if ("responseId" in result) {
        const { data: task, error } = await auth.supabaseAdmin
          .from("specialist_ai_chat_tasks")
          .insert({
            specialist_user_id: auth.user.id,
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
          .select("id,provider,model,response_id,status,request_messages,result_text,error_text,started_at,finished_at,created_at,updated_at")
          .single();
        if (error) {
          return res.status(500).json({
            ok: false,
            error: /specialist_ai_chat_tasks/i.test(error.message || "")
              ? "В базе нет таблицы specialist_ai_chat_tasks. Выполните SQL миграцию supabase/specialist_ai_chat_tasks.sql."
              : error.message,
          });
        }
        return res.status(200).json({ ok: true, provider, model, ...result, task });
      }
      return res.status(200).json({ ok: true, provider, model, ...result });
    }
    const text = await callDeepseek({ model, messages, temperature, maxOutputTokens });
    return res.status(200).json({ ok: true, provider, model, text });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "AI request failed" });
  }
}
