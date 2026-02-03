import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import type { ScoreResult } from "@/lib/score";
import { DEFAULT_TEST_INTERPRETATIONS } from "@/lib/defaultTestInterpretations";

type Audience = "staff" | "client";

type ColorTag = "red" | "green" | "blue";

function classifyColorTypes(ranked: any[]) {
  const byTag: Record<string, number> = {};
  for (const r of ranked || []) {
    const tag = String(r?.tag || "").toLowerCase();
    const cnt = Number(r?.count ?? 0);
    if (tag) byTag[tag] = cnt;
  }

  const red = Number(byTag.red ?? 0);
  const green = Number(byTag.green ?? 0);
  const blue = Number(byTag.blue ?? 0);

  // Special rule agreed with the user:
  // If ALL three colors are in 10–13 inclusive, treat as "balanced triad": all three dominate.
  const isTriad1013 = [red, green, blue].every((v) => v >= 10 && v <= 13);

  const sorted: Array<{ tag: ColorTag; count: number }> = [
    { tag: "red", count: red },
    { tag: "green", count: green },
    { tag: "blue", count: blue },
  ].sort((a, b) => b.count - a.count);

  // Base influence rule (outside the triad case): only colors >= 13 influence.
  const influencing = sorted.filter((x) => x.count >= 13);
  const nonInfluencing = sorted.filter((x) => x.count < 13);

  let leading: Array<{ tag: ColorTag; count: number }> = [];
  let scenario: "triad" | "single" | "pair" | "triple" | "flat" = "single";

  if (isTriad1013) {
    scenario = "triad";
    leading = [...sorted];
  } else if (influencing.length === 0) {
    // Extremely rare in this test, but handle gracefully.
    scenario = "flat";
    leading = [sorted[0]];
  } else if (influencing.length === 1) {
    scenario = "single";
    leading = [influencing[0]];
  } else {
    // At least two influencing colors (>=13)
    const top = influencing[0];
    const second = influencing[1];
    const d12 = Math.abs(top.count - second.count);

    if (d12 <= 3) {
      // Close leaders → multiple leaders
      leading = [top, second];
      scenario = "pair";
      const third = influencing[2];
      if (third) {
        const d23 = Math.abs(second.count - third.count);
        if (d23 <= 3) {
          leading.push(third);
          scenario = "triple";
        }
      }
    } else {
      // Not close, but still mixed if two colors are influencing.
      leading = [top, second];
      scenario = "pair";
    }
  }

  const nameByTag: Record<ColorTag, string> = {
    red: "Красный",
    green: "Зелёный",
    blue: "Синий",
  };

  return {
    counts: { red, green, blue },
    isTriad1013,
    scenario,
    leading,
    influencing,
    nonInfluencing,
    nameByTag,
  };
}

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
  audience: Audience;
}) {
  const { testTitle, result, keys, audience } = args;

  const lines: string[] = [];

  if (audience === "staff") {
    lines.push(`Ты — эксперт-психолог и ведущий тренинга. Твоя задача: дать расшифровку результатов теста «${testTitle}» строго по предоставленным ключам.`);
  } else {
    lines.push(`Ты — эксперт-психолог и ведущий тренинга. Твоя задача: подготовить текст для УЧАСТНИКА по результатам теста «${testTitle}» строго по предоставленным ключам.`);
  }

  lines.push("");
  lines.push("Правила:");
  lines.push("- Пиши по-русски, уверенно и ясно.");
  lines.push("- НЕ упоминай ИИ/нейросети/модели/API/промпты.");
  lines.push("- НЕ выдумывай факты о человеке. Только интерпретация по ключам и результатам.");
  if (audience === "client") {
    lines.push("- В тексте для участника ЗАПРЕЩЕНО показывать цифры, проценты, баллы, формулы, параметры (a/b), коды факторов, теги и технические названия шкал.");
    lines.push("- Пиши так, чтобы участник понял без чисел: смыслы, проявления, риски, что поможет.");
    lines.push("- Формат: 1) резюме (2–4 строки); 2) как проявляется (5–9 буллетов); 3) риски (4–7 буллетов); 4) что поможет (5–8 буллетов)." );
  } else {
    lines.push("- Формат: 1) общий вывод (3–5 предложений); 2) разбор по каждому фактору/стилю (кратко, 2–4 предложения); 3) рекомендации для тренинга (5–8 пунктов); 4) вопросы для обсуждения (5 вопросов)." );
  }

  lines.push("");
  lines.push("Результаты (для анализа; это НЕ значит, что их нужно дословно повторять в тексте участнику):");
  const kind = result?.kind;
  if (kind === "forced_pair_v1") {
    const total = result.total || 0;
    for (const r of result.ranked) lines.push(`- ${r.style} (${r.tag}): ${r.count}/${total} — ${r.level}`);
  } else if (kind === "color_types_v1") {
    const base = (result.meta as any)?.base ?? 12;
    const a = (result.meta as any)?.a ?? 0;
    const b = (result.meta as any)?.b ?? 0;
    const ranked = Array.isArray(result.ranked) ? result.ranked : [];
    const profile = classifyColorTypes(ranked);

    if (audience === "staff") {
      lines.push(`(база=${base}, a=${a}, b=${b}, сумма=36)`);
      const top1 = ranked?.[0]?.count ?? 0;
      const top2 = ranked?.[1]?.count ?? 0;
      const top3 = ranked?.[2]?.count ?? 0;
      lines.push(`Разницы: top1-top2=${Math.abs(top1 - top2)}, top2-top3=${Math.abs(top2 - top3)}`);
      for (const r of ranked) {
        lines.push(`- ${r.style} (${r.tag}): ${r.count}/36`);
      }
    }

    // Provide the model with an already computed scenario + leading colors,
    // so it cannot "invent" that a non-influencing color still affects the person.
    lines.push("");
    lines.push("СЦЕНАРИЙ УЖЕ ОПРЕДЕЛЁН ВЫЧИСЛЕНИЕМ (используй это как истину):");
    lines.push(`- triad_10_13: ${profile.isTriad1013 ? "да" : "нет"}`);
    lines.push(`- scenario: ${profile.scenario}`);
    if (audience === "staff") {
      lines.push(
        `- ведущие (влияют): ${profile.leading.map((x) => `${profile.nameByTag[x.tag]}=${x.count}`).join(", ")}`
      );
      lines.push(
        `- НЕ влияют: ${profile.nonInfluencing.map((x) => `${profile.nameByTag[x.tag]}=${x.count}`).join(", ")}`
      );
    } else {
      lines.push(`- ведущие (влияют): ${profile.leading.map((x) => profile.nameByTag[x.tag]).join(", ")}`);
      lines.push(`- НЕ влияют: ${profile.nonInfluencing.map((x) => profile.nameByTag[x.tag]).join(", ")}`);
    }

    lines.push("");
    lines.push("КРИТИЧЕСКИЕ ПРАВИЛА интерпретации цветотипов (соблюдать строго):");
    lines.push("- Правило СБАЛАНСИРОВАННОЙ ТРИАДЫ: если ВСЕ ТРИ цвета в диапазоне 10–13 (включительно), считай что у человека доминируют ВСЕ ТРИ цвета. Это отдельный сценарий triad_10_13.");
    lines.push("- Если triad_10_13 = НЕТ: то цвет с баллами < 13 НЕ ВЛИЯЕТ. Его запрещено называть активным/средним/работающим в паре. Максимум — одна короткая фраза: 'выражен слабо, не влияет'.");
    lines.push("- Правило БЛИЗОСТИ (разница 1–3 балла = несколько ведущих) применяется ТОЛЬКО среди влияющих цветов (>=13) или в сценарии triad_10_13. Оно НЕ может заставить цвет <13 внезапно 'влиять'.");
    lines.push("- 18+ — ярко выраженная доминанта; 13–17 — активный влияющий цвет. Ниже 13 — не влияет (кроме triad_10_13).");
    lines.push("- Если scenario=single: делай подробный разбор ТОЛЬКО ведущего цвета. Остальные — одной строкой 'не влияют'.");
    lines.push("- Запрещено использовать уровни 'низкая/средняя/высокая выраженность' в цветотипах. Используй только: 'ведущий', 'влияет', 'не влияет', 'смешанный профиль'.");
    lines.push("- В тексте УЧАСТНИКУ запрещены цифры/проценты/баллы/формулы. Не делай заголовки вида 'Красный (16 баллов...)' и не вставляй таблицы с числами.");
    lines.push("- Не пиши строки формата 'Красный 16/? · высокая выраженность' — это запрещено. Описывай смысл, а не отчёт в стиле анкеты.");
    lines.push("- В выводе сначала обозначь ведущий(е) цвет(а) словами, затем опиши проявления, риски и рекомендации строго по ключам.");

    lines.push("");
    lines.push("ФОРМАТ ОТВЕТА ДЛЯ ЦВЕТОТИПОВ (соблюдать):");
    if (profile.scenario === "single") {
      lines.push("1) Общий вывод (2–4 предложения): ведущий цвет один.");
      lines.push("2) Ведущий цвет: проявления (5–8 буллетов), риски (3–6 буллетов), что поможет (5–8 буллетов).");
      lines.push("3) Остальные цвета: одной строкой каждый — 'выражен слабо, не влияет'. Без подробных разборов.");
    } else {
      lines.push("1) Общий вывод (2–4 предложения): перечисли ведущие цвета и общий стиль.");
      lines.push("2) Как сочетание проявляется (6–10 буллетов). ");
      lines.push("3) Риски сочетания (4–7 буллетов). ");
      lines.push("4) Что поможет (5–8 буллетов). ");
      lines.push("5) Если ведущих несколько: отдельный короткий абзац про конфликт/баланс и как удерживать равновесие.");
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
  lines.push("Важно: Если ключи противоречат твоему опыту — игнорируй свой опыт. Следуй ключам." );
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

  // Never cache AI interpretations (important for the "Пересчитать" button)
  res.setHeader("Cache-Control", "no-store");

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { attempt_id, force } = (req.body || {}) as any;
  const attemptId = String(attempt_id || "").trim();
  if (!attemptId) return res.status(400).json({ ok: false, error: "attempt_id is required" });
  const forceRegen = Boolean(force);

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

  // Load protected keys content (fallback to embedded defaults if DB not seeded yet)
  const { data: keysRow, error: kErr } = await supabaseAdmin
    .from("test_interpretations")
    .select("content")
    .eq("test_slug", attempt.test_slug)
    .maybeSingle();

  const fallback = DEFAULT_TEST_INTERPRETATIONS[String(attempt.test_slug)] ?? null;
  const keysContent = (keysRow as any)?.content ?? fallback;

  // If the DB isn't seeded yet but we have an embedded fallback, persist it.
  // This makes the behavior consistent across environments and flows.
  if (!keysRow && fallback) {
    await supabaseAdmin
      .from("test_interpretations")
      .upsert({ test_slug: attempt.test_slug, content: fallback }, { onConflict: "test_slug" });
  }
  if (!keysContent) {
    return res.status(404).json({ ok: false, error: "Ключи к тесту не загружены" });
  }

  // If cached, return cached (fast), unless forced to regenerate
  const { data: cachedRows } = await supabaseAdmin
    .from("training_attempt_interpretations")
    .select("kind,text")
    .eq("attempt_id", attemptId)
    .in("kind", ["keys_ai", "client_draft"]);

  const cachedStaff = (cachedRows || []).find((r: any) => r.kind === "keys_ai")?.text || "";
  const cachedDraft = (cachedRows || []).find((r: any) => r.kind === "client_draft")?.text || "";

  if (!forceRegen && cachedStaff && cachedDraft) {
    return res.status(200).json({ ok: true, staff_text: cachedStaff, client_text: cachedDraft, cached: true });
  }

  // When forced, regenerate both texts even if cached.
  let staffText = forceRegen ? "" : cachedStaff;
  let clientDraft = forceRegen ? "" : cachedDraft;

  if (!staffText) {
    const promptStaff = buildKeysPrompt({ testTitle, result: attempt.result as any, keys: keysContent, audience: "staff" });
    staffText = await callDeepseek(promptStaff);
    await supabaseAdmin.from("training_attempt_interpretations").upsert(
      { attempt_id: attemptId, kind: "keys_ai", text: staffText },
      { onConflict: "attempt_id,kind" }
    );
  }

  if (!clientDraft) {
    const promptClient = buildKeysPrompt({ testTitle, result: attempt.result as any, keys: keysContent, audience: "client" });
    clientDraft = await callDeepseek(promptClient);
    await supabaseAdmin.from("training_attempt_interpretations").upsert(
      { attempt_id: attemptId, kind: "client_draft", text: clientDraft },
      { onConflict: "attempt_id,kind" }
    );
  }

  return res.status(200).json({ ok: true, staff_text: staffText, client_text: clientDraft, cached: false });
}
