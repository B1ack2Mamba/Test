import { retryTransientApi } from "@/lib/apiHardening";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type CallDeepseekTextArgs = {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  retries?: number;
};

function isReasoningModel(model: string) {
  return /reasoner/i.test(String(model || ""));
}

function normalizeBaseUrl(base: string) {
  const trimmed = String(base || "").trim().replace(/\/$/, "");
  return trimmed || "https://api.deepseek.com";
}

function numericEnv(name: string): number | null {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveModel(input?: string) {
  const model = String(input || process.env.DEEPSEEK_MODEL || "deepseek-chat").trim();
  return model || "deepseek-chat";
}

function resolveMaxTokens(model: string, requested?: number) {
  const generic = numericEnv("DEEPSEEK_MAX_TOKENS");
  const reasoner = numericEnv("DEEPSEEK_REASONER_MAX_TOKENS");
  const fallback = Math.max(256, Number(requested || 0) || (isReasoningModel(model) ? 9000 : 3200));
  if (isReasoningModel(model) && reasoner) return Math.max(reasoner, fallback);
  if (generic) return Math.max(generic, fallback);
  if (isReasoningModel(model)) return Math.max(9000, fallback);
  return fallback;
}

function extractContent(content: any): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

export async function callDeepseekText(args: CallDeepseekTextArgs): Promise<string> {
  const key = String(process.env.DEEPSEEK_API_KEY || "").trim();
  if (!key) throw new Error("DEEPSEEK_API_KEY is missing");

  const model = resolveModel(args.model);
  const base = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com");
  const maxTokens = resolveMaxTokens(model, args.maxTokens);
  const timeoutMs = Math.max(15_000, Number(args.timeoutMs || process.env.DEEPSEEK_TIMEOUT_MS || 60_000));
  const retries = Math.max(1, Number(args.retries || 2));
  const messages: ChatMessage[] = [
    { role: "system", content: args.systemPrompt },
    { role: "user", content: args.userPrompt },
  ];

  return await retryTransientApi<string>(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const payload: Record<string, any> = {
        model,
        messages,
        max_tokens: maxTokens,
      };
      if (!isReasoningModel(model) && Number.isFinite(Number(args.temperature))) {
        payload.temperature = Number(args.temperature);
      }

      const r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const j = await r.json().catch(() => null);
      const choice = j?.choices?.[0];
      const message = choice?.message || {};
      const finishReason = String(choice?.finish_reason || "").trim();
      const text = extractContent(message?.content);
      const reasoningText = extractContent(message?.reasoning_content);
      const reasoningTokens = Number(j?.usage?.completion_tokens_details?.reasoning_tokens || 0);

      if (r.ok && text) return text;

      const apiMessage = String(j?.error?.message || "").trim();
      if (apiMessage) {
        if (r.status === 429 || r.status >= 500) throw new Error(apiMessage);
        throw new Error(apiMessage);
      }

      if (r.ok && !text && finishReason === "length") {
        const extra = reasoningTokens > 0 || reasoningText
          ? " Похоже, thinking-режим израсходовал max_tokens на рассуждение раньше, чем дошёл до финального ответа."
          : "";
        throw new Error(`DeepSeek вернул пустой финальный ответ (finish_reason=length). Увеличьте max_tokens.${extra}`);
      }

      if (r.ok && !text && reasoningText) {
        throw new Error("DeepSeek вернул reasoning_content, но не прислал финальный answer content. Для reasoner обычно помогает увеличить max_tokens.");
      }

      if (r.status === 429 || r.status >= 500) {
        throw new Error(`DeepSeek error (${r.status})`);
      }
      throw new Error(`DeepSeek ответил без текста (${r.status || 200}). model=${model}${finishReason ? `; finish_reason=${finishReason}` : ""}`);
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error(`DeepSeek timeout after ${timeoutMs}ms`);
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }, { attempts: retries, delayMs: 350 });
}
