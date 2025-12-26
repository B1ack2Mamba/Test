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

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function pct(n: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return clamp(Math.round(x), 0, 100);
}

function safeStr(v: any) {
  return String(v ?? "").trim();
}

function buildPrompt(testTitle: string, result: ScoreResult, testJson?: any): string {
  const kind = (result?.kind || "forced_pair_v1") as ScoreResult["kind"];

  if (kind === "pair_sum5_v1") {
    const factorToName: Record<string, string> = testJson?.scoring?.factor_to_name || {};
    const lines: string[] = [];
    lines.push(
      `Ты — консультант по мотивации и карьере. Дай понятное и практичное подведение итогов по результатам теста «${testTitle}».`
    );
    lines.push("\nТребования к ответу:");
    lines.push("- Пиши по-русски, кратко, но содержательно.");
    lines.push("- Не упоминай технологии, модели, нейросети, ИИ, API и т.п.");
    lines.push(
      "- Структура: 1) общий вывод (2–3 предложения); 2) топ-3 фактора с объяснением; 3) что важно учесть при выборе работы/условий; 4) риски (2–3) и как их компенсировать; 5) 5 практических шагов на ближайшие 7 дней."
    );
    lines.push("\nМои результаты (проценты — относительная важность фактора):");
    for (const r of result.ranked) {
      const name = factorToName[r.tag] ? ` — ${factorToName[r.tag]}` : "";
      lines.push(`- ${r.tag}${name}: ${r.percent}% — ${r.level}`);
    }
    lines.push("\nВажно: не придумывай факты обо мне. Опирайся только на результаты.");
    return lines.join("\n");
  }

  const lines: string[] = [];
  lines.push(`Ты — психолог/коуч. Дай понятную и полезную расшифровку результатов теста «${testTitle}».`);
  lines.push("\nТребования к ответу:");
  lines.push("- Пиши по-русски, без воды, но дружелюбно.");
  lines.push("- Объясни, что означают лидирующие стили/тенденции и чем они полезны/опасны.");
  lines.push("- Дай 5–8 конкретных рекомендаций.");
  lines.push("- Добавь 3 типичных ошибки для моего профиля и как их избежать.");
  lines.push("- В конце: короткий план на 7 дней (по 1 действию в день).");
  lines.push("\nМои результаты:");
  for (const r of result.ranked) {
    lines.push(`- ${r.style} (${r.tag}): ${r.percent}% — ${r.level}`);
  }
  lines.push("\nВажно: не придумывай факты обо мне.");
  return lines.join("\n");
}

function buildLocalDetail(testTitle: string, result: ScoreResult, testJson?: any): string {
  const kind = (result?.kind || "forced_pair_v1") as ScoreResult["kind"];

  if (kind === "pair_sum5_v1") {
    const factorToName: Record<string, string> = testJson?.scoring?.factor_to_name || {};
    const top = (Array.isArray(result.ranked) ? result.ranked : []).slice(0, 3);

    const g = result?.meta?.groups || {};
    const hygieneP = g.hygiene ? pct((g.hygiene.sum / Math.max(1, g.hygiene.max)) * 100) : null;
    const motivP = g.motivators ? pct((g.motivators.sum / Math.max(1, g.motivators.max)) * 100) : null;

    const topNames = top
      .map((r) => factorToName[r.tag] || r.tag)
      .filter(Boolean)
      .join(", ");

    const lines: string[] = [];
    lines.push(`Общий вывод: сейчас вашу мотивацию сильнее всего поднимают ${topNames || "ведущие факторы"}. ` +
      "Это те вещи, на которые стоит опираться при выборе задач, условий и формата работы.");

    if (hygieneP !== null && motivP !== null) {
      lines.push(
        `Баланс мотивации: условия/комфорт (гигиена) — ${hygieneP}%, смысл/рост (мотивация) — ${motivP}%. ` +
          "Если один блок сильно выше — важно не «переехать» в перекос: комфорт без смысла быстро надоедает, а смысл без условий выжигает."
      );
    }

    lines.push("\nТоп-3 фактора и что с ними делать:");
    top.forEach((r, i) => {
      const name = factorToName[r.tag] || r.tag;
      const level = r.level;
      const percent = pct(r.percent);
      lines.push(
        `${i + 1}) ${name} — ${level} (${percent}%). ` +
          "Старайтесь выбирать задачи/условия, где этот фактор вы реально сможете «кормить» ежедневно — иначе мотивация будет проседать даже при хорошей зарплате."
      );
    });

    lines.push("\nНа что обратить внимание при выборе работы/проекта:");
    lines.push("- Описывайте себе «идеальную неделю»: какие задачи, темп, контроль, коммуникации. Сверяйте с этим предложения.");
    lines.push("- Договоритесь о 2–3 измеримых критериях успеха, чтобы мотивация не зависела от настроения окружающих.");
    lines.push("- Если условия сильно влияют на вас — фиксируйте их в договорённостях (график, формат, ответственность, правила обратной связи)."
    );

    lines.push("\nРиски и как компенсировать:");
    lines.push("- Перегореть на фоне «хочу идеально»: ставьте недельные спринты и оставляйте 20% запаса времени.");
    lines.push("- Потерять интерес после старта: заранее планируйте усложнение/рост на 2–4 недели вперёд.");
    lines.push("- Зависеть от внешней оценки: переводите ожидания в конкретные метрики и регулярные короткие отчёты.");

    lines.push("\n5 шагов на ближайшие 7 дней:");
    lines.push("1) Выпишите 5 ситуаций, где вы были максимально вовлечены — найдите в них общий паттерн.");
    lines.push("2) Сформулируйте 3 требования к условиям (что обязательно) и 3 «приятно иметь».");
    lines.push("3) Обновите резюме/профиль: подчеркните, какие задачи вас реально драйвят." );
    lines.push("4) Проведите 1 разговор/созвон: уточните ожидания, критерии успеха, формат обратной связи." );
    lines.push("5) Выберите одну привычку на поддержку энергии: сон/спорт/планирование — и держите 7 дней." );
    return lines.join("\n");
  }

  // Default fallback
  const top = (Array.isArray(result.ranked) ? result.ranked : []).slice(0, 2);
  const lines: string[] = [];
  lines.push(`Общий вывод по «${testTitle}»: ведущие тенденции — ${top.map((r) => r.style).join(" и ") || "—"}.`);
  lines.push("\nЧто это значит на практике:");
  top.forEach((r, i) => {
    lines.push(`${i + 1}) ${r.style}: ${pct(r.percent)}% — ${r.level}. Сильная сторона — уверенность в этом стиле; риск — использовать его «по привычке» там, где нужна другая тактика.`);
  });
  lines.push("\nРекомендации:");
  lines.push("- Перед важным разговором выбирайте цель (результат) и отношения (как вы хотите выглядеть для человека)." );
  lines.push("- Подготовьте 2–3 альтернативы: если первая стратегия не сработала — переключайтесь, а не давите." );
  lines.push("- В конце разговора фиксируйте договорённости: кто/что/когда." );
  lines.push("\nПлан на 7 дней: 1 разговор — 1 микроулучшение (подготовка, вопросы, фиксация, пауза, резюме)." );
  return lines.join("\n");
}

async function tryDeepseek(prompt: string): Promise<string | null> {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (!deepseekKey) return null;

  const base = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${deepseekKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Ты помогаешь пользователю понять результаты теста." },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
        max_tokens: 900,
      }),
    });

    const raw = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = null;
    }

    if (!r.ok) return null;
    const text: string | undefined = json?.choices?.[0]?.message?.content;
    return text ? String(text).trim() : null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<OkResp | ErrResp>) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;

  const body = (req.body ?? {}) as Body;
  const testSlug = safeStr(body.test_slug);
  const testTitle = safeStr(body.test_title) || "Тест";
  const result = body.result;

  if (!testSlug) return res.status(400).json({ ok: false, error: "test_slug is required" });
  if (!result) return res.status(400).json({ ok: false, error: "result is required" });

  const ref = body.op_id ? `detail:${testSlug}:${safeStr(body.op_id)}` : `detail:${testSlug}:${Date.now()}`;

  // Charge wallet
  const { data: debitData, error: debitErr } = await auth.supabaseAdmin.rpc("debit_wallet", {
    p_user_id: auth.user.id,
    p_amount_kopeks: PRICE_KOPEKS,
    p_reason: "detailed_interpretation",
    p_ref: ref,
  });
  if (debitErr) {
    return res.status(400).json({ ok: false, error: debitErr.message || "Failed to charge wallet" });
  }

  const { data: testRow } = await auth.supabaseAdmin.from("tests").select("json").eq("slug", testSlug).single();

  // Prefer external summary if configured; otherwise (or on failure) return a deterministic local summary.
  const prompt = buildPrompt(testTitle, result, testRow?.json);
  const external = await tryDeepseek(prompt);
  const text = external || buildLocalDetail(testTitle, result, testRow?.json);

  const balance = Number(debitData?.balance_kopeks ?? 0);
  const charged = Number(debitData?.charged_kopeks ?? PRICE_KOPEKS);
  return res.status(200).json({ ok: true, text, balance_kopeks: balance, charged_kopeks: charged });
}
