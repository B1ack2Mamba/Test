import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import type { ScoreResult } from "@/lib/score";

type Body = {
  test_slug?: string;
  test_title?: string;
  result?: ScoreResult;
  op_id?: string;
};

type OkResp = { ok: true; text: string; balance_kopeks: number; charged_kopeks: number };
type ErrResp = { ok: false; error: string };

const PRICE_KOPEKS = 4900; // 49 ₽

function buildPrompt(testTitle: string, result: ScoreResult): string {
  const lines: string[] = [];
  lines.push(`Ты — психолог/коуч по переговорам. Дай понятную и полезную расшифровку результатов теста «${testTitle}».`);
  lines.push("\nТребования к ответу:");
  lines.push("- Пиши по-русски, без воды, но дружелюбно.");
  lines.push("- Объясни, что означают лидирующие стили и чем они полезны/опасны.");
  lines.push("- Дай 5–8 конкретных рекомендаций, как улучшить переговоры.");
  lines.push("- Добавь 3 типичных ошибки для моего профиля и как их избежать.");
  lines.push("- В конце: короткий план на 7 дней (по 1 действию в день).");

  lines.push("\nМои результаты (по стилям):");
  for (const r of result.ranked) {
    lines.push(`- ${r.style} (буква ${r.tag}): ${r.count}/${result.total} = ${r.percent}% — ${r.level}`);
  }

  lines.push("\nВажно: не упоминай никакие юридические дисклеймеры. Не придумывай факты обо мне, которых нет в данных.");
  return lines.join("\n");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<OkResp | ErrResp>) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const deepseekBaseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  if (!deepseekKey) {
    return res.status(500).json({ ok: false, error: "Server env missing: DEEPSEEK_API_KEY" });
  }

  const body = (req.body ?? {}) as Body;
  const testSlug = String(body.test_slug || "").trim();
  const testTitle = String(body.test_title || "Тест").trim() || "Тест";
  if (!testSlug) return res.status(400).json({ ok: false, error: "test_slug is required" });
  if (!body.result) return res.status(400).json({ ok: false, error: "result is required" });

  const ref = body.op_id ? `ai:${testSlug}:${body.op_id}` : `ai:${testSlug}:${Date.now()}`;

  // Charge wallet
  const { data: debitData, error: debitErr } = await auth.supabaseAdmin.rpc("debit_wallet", {
    p_user_id: auth.user.id,
    p_amount_kopeks: PRICE_KOPEKS,
    p_reason: "ai_interpretation",
    p_ref: ref,
  });

  if (debitErr) {
    return res.status(400).json({ ok: false, error: debitErr.message || "Failed to charge wallet" });
  }

  const prompt = buildPrompt(testTitle, body.result);

  const aiResp = await fetch(`${deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${deepseekKey}`,
    },
    body: JSON.stringify({
      model: deepseekModel,
      messages: [
        { role: "system", content: "Ты помогаешь пользователю понять результаты психологического теста." },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 900,
    }),
  });

  const raw = await aiResp.text();
  let json: any = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // ignore
  }

  if (!aiResp.ok) {
    const msg = json?.error?.message || json?.message || raw || "AI error";
    return res.status(502).json({ ok: false, error: msg });
  }

  const text: string | undefined = json?.choices?.[0]?.message?.content;
  if (!text) {
    return res.status(502).json({ ok: false, error: "AI response missing content" });
  }

  const balance = Number(debitData?.balance_kopeks ?? 0);
  const charged = Number(debitData?.charged_kopeks ?? PRICE_KOPEKS);
  return res.status(200).json({ ok: true, text, balance_kopeks: balance, charged_kopeks: charged });
}
