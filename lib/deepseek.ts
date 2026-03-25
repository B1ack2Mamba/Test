import { retryTransientApi } from "@/lib/apiHardening";

export type DeepseekCallOptions = {
  system: string;
  user: string;
  timeoutMs?: number;
  attempts?: number;
  temperature?: number;
  maxTokensChat?: number;
  maxTokensReasoner?: number;
};

function normalizeBaseUrl(input?: string) {
  const raw = String(input || "https://api.deepseek.com").trim().replace(/\/$/, "");
  return raw.replace(/\/chat\/completions$/i, "");
}

export async function callDeepseekText(opts: DeepseekCallOptions): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is missing");

  const base = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL);
  const model = String(process.env.DEEPSEEK_MODEL || "deepseek-chat").trim() || "deepseek-chat";
  const isReasoner = model === "deepseek-reasoner";
  const timeoutMs = Math.max(15_000, Number(opts.timeoutMs || process.env.DEEPSEEK_TIMEOUT_MS || 60_000));
  const maxTokensChat = Math.max(800, Number(opts.maxTokensChat || process.env.DEEPSEEK_MAX_TOKENS || 3200));
  const maxTokensReasoner = Math.max(4000, Number(opts.maxTokensReasoner || process.env.DEEPSEEK_REASONER_MAX_TOKENS || 12000));
  const max_tokens = isReasoner ? maxTokensReasoner : maxTokensChat;

  return await retryTransientApi<string>(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const payload: Record<string, any> = {
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
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
        let extra = "";
        if (finishReason === "length") {
          extra = ` Модель упёрлась в max_tokens=${max_tokens} до финального ответа.`;
        } else if (reasoning) {
          extra = " Модель вернула reasoning_content, но финальный content пуст.";
        }
        throw new Error(`DeepSeek ответил без текста (200).${extra}`.trim());
      }

      return text;
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error(`DeepSeek timeout after ${timeoutMs}ms`);
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }, { attempts: Math.max(1, Number(opts.attempts || 2)), delayMs: 350 });
}
