import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import type { ScoreResult } from "@/lib/score";

function safeJson(v: any) {
  try {
    return JSON.stringify(v ?? null, null, 2);
  } catch {
    return String(v ?? "");
  }
}

function buildKeysPrompt(args: {
  testTitle: string;
  result: ScoreResult;
  keys: any;
}) {
  const { testTitle, result, keys } = args;

  const lines: string[] = [];
  lines.push(`Ты — эксперт-психолог и ведущий тренинга. Твоя задача: дать расшифровку результатов теста «${testTitle}» строго по предоставленным ключам.`);
  lines.push("");
  lines.push("Правила:");
  lines.push("- Пиши по-русски, уверенно и ясно.");
  lines.push("- НЕ упоминай ИИ/нейросети/модели/API/промпты.");
  lines.push("- НЕ выдумывай факты о человеке. Только интерпретация по ключам и цифрам.");
  lines.push("- Формат: 1) общий вывод (3–5 предложений); 2) разбор по каждому фактору/стилю (кратко, 2–4 предложения); 3) рекомендации для тренинга (5–8 пунктов); 4) вопросы для обсуждения (5 вопросов).");
  lines.push("");
  lines.push("Результаты (цифры):");
  // Prefer counts and maxes
  const kind = result?.kind;
  if (kind === "forced_pair_v1") {
    const total = result.total || 0;
    for (const r of result.ranked) {
      lines.push(`- ${r.style} (${r.tag}): ${r.count}/${total} — ${r.level}`);
    }
  } else if (kind === "color_types_v1") {
    const base = (result.meta as any)?.base ?? 12;
    const a = (result.meta as any)?.a ?? 0;
    const b = (result.meta as any)?.b ?? 0;
    lines.push(`(база=${base}, a=${a}, b=${b}, сумма=36)`);
    for (const r of result.ranked) {
      const pct = typeof (r as any).percent === "number" ? Math.round((r as any).percent) : null;
      lines.push(`- ${r.style} (${r.tag}): ${r.count}/36${pct !== null ? ` (~${pct}%)` : ""} — ${r.level}`);
    }
  } else {
    const maxByFactor = (result.meta as any)?.maxByFactor || {};
    for (const r of result.ranked) {
      const mx = maxByFactor?.[r.tag] ?? "?";
      lines.push(`- ${r.style} (${r.tag}): ${r.count}/${mx} — ${r.level}`);
    }
  }
  lines.push("");
  lines.push("Ключи (используй как единственный источник смыслов и формулировок):");
  lines.push(safeJson(keys));
  lines.push("");
  lines.push("Важно: Если ключи противоречат твоему опыту — игнорируй свой опыт. Следуй ключам.");
  return lines.join("\n");
}

async function callDeepseek(prompt: string): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY is missing");
  const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Ты помогаешь специалисту расшифровать результаты тестов для тренинга." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 1200,
    }),
  });

  const j = await r.json().catch(() => null);
  const text = j?.choices?.[0]?.message?.content;
  if (!r.ok || !text) {
    throw new Error(j?.error?.message || `DeepSeek error (${r.status})`);
  }
  return String(text).trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { attempt_id } = (req.body || {}) as any;
  const attemptId = String(attempt_id || "").trim();
  if (!attemptId) return res.status(400).json({ ok: false, error: "attempt_id is required" });

  // Load attempt + test
  const { data: attempt, error: aErr } = await supabaseAdmin
    .from("training_attempts")
    .select("id,test_slug,result")
    .eq("id", attemptId)
    .maybeSingle();

  if (aErr || !attempt) return res.status(404).json({ ok: false, error: "Attempt not found" });

  // Load test title
  const { data: testRow } = await supabaseAdmin
    .from("tests")
    .select("title")
    .eq("slug", attempt.test_slug)
    .maybeSingle();

  const testTitle = String((testRow as any)?.title || attempt.test_slug);

  // Load protected keys content
  const { data: keysRow, error: kErr } = await supabaseAdmin
    .from("test_interpretations")
    .select("content")
    .eq("test_slug", attempt.test_slug)
    .maybeSingle();

  if (kErr || !keysRow) return res.status(404).json({ ok: false, error: "Ключи к тесту не загружены" });

  // If cached, return cached (fast)
  const { data: cached } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .select("text")
    .eq("attempt_id", attemptId)
    .eq("kind", "keys_ai")
    .maybeSingle();

  if (cached?.text) return res.status(200).json({ ok: true, text: cached.text, cached: true });

  const prompt = buildKeysPrompt({ testTitle, result: attempt.result as any, keys: (keysRow as any).content });

  const text = await callDeepseek(prompt);

  await supabaseAdmin.from("training_attempt_interpretations").upsert(
    {
      attempt_id: attemptId,
      kind: "keys_ai",
      text,
    },
    { onConflict: "attempt_id,kind" }
  );

  return res.status(200).json({ ok: true, text, cached: false });
}
