import { retryTransientApi } from "@/lib/apiHardening";

export type DeepseekCallOptions = {
  system: string;
  user: string;
  timeoutMs?: number;
  attempts?: number;
  temperature?: number;
  maxTokensChat?: number;
  maxTokensReasoner?: number;
  modelOverride?: string;
  fallbackToChatOnEmpty?: boolean;
};

function normalizeBaseUrl(input?: string) {
  const raw = String(input || "https://api.deepseek.com").trim().replace(/\/$/, "");
  return raw.replace(/\/chat\/completions$/i, "");
}

function isNoTextResponseError(message: string) {
  return /ответил без текста \(200\)/i.test(String(message || ""));
}

function extractTextFromMessageContent(content: any): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        if (typeof part?.value === "string") return part.value;
        return "";
      })
      .join("")
      .trim();
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text.trim();
    if (typeof content.content === "string") return content.content.trim();
    if (typeof content.value === "string") return content.value.trim();
  }
  return "";
}

export async function callDeepseekText(opts: DeepseekCallOptions): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is missing");

  const base = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL);
  const envModel = String(process.env.DEEPSEEK_MODEL || "deepseek-chat").trim() || "deepseek-chat";
  const initialModel = String(opts.modelOverride || envModel).trim() || envModel;
  const timeoutMs = Math.max(15_000, Number(opts.timeoutMs || process.env.DEEPSEEK_TIMEOUT_MS || 60_000));
  const hardMaxTokens = Math.max(256, Number(process.env.DEEPSEEK_HARD_MAX_TOKENS || 8192));
  const maxTokensChat = Math.min(hardMaxTokens, Math.max(800, Number(opts.maxTokensChat || process.env.DEEPSEEK_MAX_TOKENS || 3200)));
  const maxTokensReasoner = Math.min(hardMaxTokens, Math.max(4000, Number(opts.maxTokensReasoner || process.env.DEEPSEEK_REASONER_MAX_TOKENS || 7000)));

  async function requestText(
    model: string,
    mode: "normal" | "merged-user",
    reasonerBoost = 1,
    chatBoost = 1,
    temperatureOverride?: number
  ): Promise<string> {
    const isReasoner = model === "deepseek-reasoner";
    const max_tokens = isReasoner
      ? Math.min(hardMaxTokens, Math.max(4000, Math.round(maxTokensReasoner * reasonerBoost)))
      : Math.min(hardMaxTokens, Math.max(800, Math.round(maxTokensChat * chatBoost)));

    const system = String(opts.system || "").trim();
    const user = String(opts.user || "").trim();
    const messages = mode === "merged-user"
      ? [{ role: "user", content: [system, user].filter(Boolean).join("\n\n") }]
      : [
          ...(system ? [{ role: "system", content: system }] : []),
          { role: "user", content: user },
        ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const payload: Record<string, any> = {
        model,
        messages,
        max_tokens,
      };
      const effectiveTemperature = Number.isFinite(Number(temperatureOverride))
        ? Number(temperatureOverride)
        : Number(opts.temperature);
      if (!isReasoner && Number.isFinite(effectiveTemperature)) {
        payload.temperature = effectiveTemperature;
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
      const choice = j?.choices?.[0] || null;
      const message = choice?.message || {};
      const text = extractTextFromMessageContent(message?.content);
      const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content.trim() : "";
      const finishReason = String(choice?.finish_reason || "").trim();

      if (!r.ok) {
        const msg = String(j?.error?.message || `DeepSeek error (${r.status})`);
        if (r.status === 429 || r.status >= 500) throw new Error(msg);
        throw new Error(msg);
      }

      if (!text) {
        let extra = ` model=${model}; max_tokens=${max_tokens}`;
        if (finishReason === "length") {
          extra += `; finish_reason=length`;
        } else if (finishReason) {
          extra += `; finish_reason=${finishReason}`;
        }
        const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0;
        if (reasoning) extra += "; есть reasoning_content без финального content";
        if (toolCalls) extra += `; tool_calls=${toolCalls}`;
        throw new Error(`DeepSeek ответил без текста (200).${extra}`);
      }

      return text;
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error(`DeepSeek timeout after ${timeoutMs}ms`);
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  return await retryTransientApi<string>(async () => {
    try {
      return await requestText(initialModel, "normal", 1);
    } catch (e1: any) {
      const shouldFallback = (opts.fallbackToChatOnEmpty ?? true) && isNoTextResponseError(String(e1?.message || ""));
      if (!shouldFallback) throw e1;

      if (initialModel === "deepseek-reasoner") {
        try {
          return await requestText("deepseek-reasoner", "merged-user", 2, 1);
        } catch (e2: any) {
          if (!isNoTextResponseError(String(e2?.message || ""))) throw e2;
          try {
            return await requestText("deepseek-chat", "normal", 1, 2, 0.2);
          } catch (e3: any) {
            if (!isNoTextResponseError(String(e3?.message || ""))) throw e3;
            return await requestText("deepseek-chat", "merged-user", 1, 3, 0.1);
          }
        }
      }

      try {
        return await requestText(initialModel, "merged-user", 1, 2, 0.2);
      } catch (e2: any) {
        if (!isNoTextResponseError(String(e2?.message || ""))) throw e2;
        return await requestText("deepseek-chat", "merged-user", 1, 3, 0.1);
      }
    }
  }, { attempts: Math.max(1, Number(opts.attempts || 2)), delayMs: 350 });
}
