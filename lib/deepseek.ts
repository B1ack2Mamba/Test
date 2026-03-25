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

export async function callDeepseekText(opts: DeepseekCallOptions): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is missing");

  const base = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL);
  const envModel = String(process.env.DEEPSEEK_MODEL || "deepseek-chat").trim() || "deepseek-chat";
  const initialModel = String(opts.modelOverride || envModel).trim() || envModel;
  const timeoutMs = Math.max(15_000, Number(opts.timeoutMs || process.env.DEEPSEEK_TIMEOUT_MS || 60_000));
  const maxTokensChat = Math.max(800, Number(opts.maxTokensChat || process.env.DEEPSEEK_MAX_TOKENS || 3200));
  const maxTokensReasoner = Math.max(4000, Number(opts.maxTokensReasoner || process.env.DEEPSEEK_REASONER_MAX_TOKENS || 12000));

  async function requestText(model: string, mode: "normal" | "merged-user", reasonerBoost = 1): Promise<string> {
    const isReasoner = model === "deepseek-reasoner";
    const max_tokens = isReasoner
      ? Math.min(64000, Math.max(8000, Math.round(maxTokensReasoner * reasonerBoost)))
      : maxTokensChat;

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
      if (!isReasoner && Number.isFinite(Number(opts.temperature))) {
        payload.temperature = Number(opts.temperature);
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
      const text = typeof message?.content === "string" ? message.content.trim() : "";
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
        if (reasoning) extra += "; есть reasoning_content без финального content";
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
          return await requestText("deepseek-reasoner", "merged-user", 2);
        } catch (e2: any) {
          if (!isNoTextResponseError(String(e2?.message || ""))) throw e2;
          return await requestText("deepseek-chat", "normal", 1);
        }
      }

      throw e1;
    }
  }, { attempts: Math.max(1, Number(opts.attempts || 2)), delayMs: 350 });
}
