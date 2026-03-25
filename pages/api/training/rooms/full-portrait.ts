import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { retryTransientApi, setNoStore } from "@/lib/apiHardening";
import { callDeepseekText } from "@/lib/deepseek";

function trimText(s: any, maxLen = 1400) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return t.length > maxLen ? t.slice(0, maxLen).trimEnd() + "…" : t;
}

function safeJson(v: any) {
  try {
    return JSON.stringify(v ?? null, null, 2);
  } catch {
    return String(v ?? "");
  }
}

function summarizeResult(result: any): string {
  if (!result || typeof result !== "object") return "Нет результата.";

  const lines: string[] = [];
  const kind = String(result.kind || "");
  const ranked = Array.isArray(result.ranked) ? result.ranked : [];
  const meta = (result.meta || {}) as any;
  const maxByFactor = (meta.maxByFactor || {}) as Record<string, number>;

  if (kind === "16pf_v1") {
    const norm = meta.normGroupLabel || meta.normLabel || meta.norm_group_label || "—";
    const stenByFactor = meta.stenByFactor || {};
    const rawByFactor = meta.rawByFactor || {};
    const maxRawByFactor = meta.maxRawByFactor || {};
    lines.push(`Нормативная группа: ${norm}`);
    lines.push("Первичные факторы:");
    for (const row of ranked) {
      const tag = String(row?.tag || "");
      const style = String(row?.style || tag || "Шкала");
      const sten = Number(stenByFactor?.[tag] ?? row?.count ?? 0);
      const raw = Number(rawByFactor?.[tag] ?? 0);
      const rawMax = Number(maxRawByFactor?.[tag] ?? 0);
      const level = String(row?.level || "");
      lines.push(`- ${style} (${tag}): STEN ${sten}/10; сырые ${raw}/${rawMax || "?"}; уровень ${level || "—"}`);
    }
    const secondary = meta.secondary || {};
    const secRows = Object.entries(secondary || {});
    if (secRows.length) {
      lines.push("Вторичные факторы:");
      for (const [code, v] of secRows) {
        const item: any = v || {};
        lines.push(`- ${code}: ${item.name || code}; STEN ${item.count ?? item.sten ?? "?"}/10; знак ${item.sign || "—"}; уровень ${item.level || "—"}`);
      }
    }
    return lines.join("\n");
  }

  if (kind === "color_types_v1") {
    const counts = result.counts || {};
    lines.push(`Красный: ${counts.red ?? 0}`);
    lines.push(`Зелёный: ${counts.green ?? 0}`);
    lines.push(`Синий: ${counts.blue ?? 0}`);
  }

  if (ranked.length) {
    lines.push("Шкалы:");
    for (const row of ranked) {
      const tag = String(row?.tag || "");
      const style = String(row?.style || tag || "Шкала");
      const count = Number(row?.count ?? 0);
      const max = Number(maxByFactor?.[tag] ?? result.total ?? 0);
      const pct = Number(row?.percent ?? 0);
      const level = String(row?.level || "");
      lines.push(`- ${style} (${tag}): ${count}${max ? `/${max}` : ""}; ${pct}%${level ? `; уровень ${level}` : ""}`);
    }
  } else {
    lines.push(trimText(safeJson(result), 2400));
  }

  if (meta?.dominant) lines.push(`Доминирующее направление: ${String(meta.dominant)}`);
  if (meta?.blend) lines.push(`Смешанный профиль: ${String(meta.blend)}`);
  if (Array.isArray(meta?.leaders) && meta.leaders.length) lines.push(`Лидеры: ${meta.leaders.join(", ")}`);
  if (Array.isArray(meta?.mixedLeaders) && meta.mixedLeaders.length) lines.push(`Смешанные лидеры: ${meta.mixedLeaders.join(", ")}`);

  return lines.join("\n");
}

function buildFullPortraitPrompt(args: {
  roomName: string;
  participantName: string;
  customPrompt: string;
  tests: Array<{ title: string; slug: string; created_at?: string | null; resultSummary: string; staffInterpretation?: string }>;
}) {
  const { roomName, participantName, customPrompt, tests } = args;
  const lines: string[] = [];

  lines.push(`Ты — сильный практикующий психолог-аналитик и ведущий тренинга.`);
  lines.push(`Нужно составить целостный профессиональный портрет клиента по ВСЕМ завершённым тестам в комнате «${roomName}».`);
  lines.push(`Клиент: ${participantName}.`);
  lines.push("");
  lines.push("Жёсткие правила:");
  lines.push("- Пиши по-русски.");
  lines.push("- Не упоминай ИИ, модель, промпт, API, нейросеть.");
  lines.push("- Не придумывай диагнозы и клинические ярлыки.");
  lines.push("- Не выдумывай факты, которых нет в данных.");
  lines.push("- Если тесты между собой противоречат, прямо покажи это как противоречие или напряжение профиля.");
  lines.push("- Синтезируй результаты, а не пересказывай их по отдельности сухим списком.");
  lines.push("- Можно ссылаться на названия шкал и тестов, но не превращай ответ в машинный отчёт.");
  lines.push("");

  if (customPrompt.trim()) {
    lines.push("Дополнительные инструкции специалиста для этой комнаты (учти их максимально точно, если они не противоречат данным):");
    lines.push(customPrompt.trim());
    lines.push("");
  }

  lines.push("Формат ответа:");
  lines.push("1. Ядро портрета — 1 плотный абзац на 6–10 предложений.");
  lines.push("2. Сильные стороны — 6–10 пунктов.");
  lines.push("3. Уязвимости и риски — 5–9 пунктов.");
  lines.push("4. Как человек обучается, принимает решения, организует себя и взаимодействует с людьми — 1–2 абзаца.");
  lines.push("5. Внутренние противоречия / напряжения профиля — 3–6 пунктов.");
  lines.push("6. Практические рекомендации специалисту по работе с этим клиентом — 7–12 пунктов.");
  lines.push("7. Вопросы, которые стоит обсудить с клиентом — 5–8 пунктов.");
  lines.push("");
  lines.push("Данные по тестам:");
  lines.push("");

  tests.forEach((t, idx) => {
    lines.push(`Тест ${idx + 1}: ${t.title} (${t.slug})`);
    if (t.created_at) lines.push(`Дата попытки: ${t.created_at}`);
    lines.push("Числовой/шкальный результат:");
    lines.push(t.resultSummary);
    if (t.staffInterpretation?.trim()) {
      lines.push("");
      lines.push("Краткая уже имеющаяся расшифровка специалиста:");
      lines.push(trimText(t.staffInterpretation, 1600));
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  lines.push("Собери именно целостный портрет человека, а не набор изолированных мини-описаний по тестам.");
  return lines.join("\n");
}

async function callDeepseek(prompt: string): Promise<string> {
  return await callDeepseekText({
    system: "Ты помогаешь специалисту собрать единый психологический портрет клиента по данным нескольких тестов.",
    user: prompt,
    temperature: 0.45,
    maxTokensChat: 3200,
    maxTokensReasoner: 12000,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { attempt_id, force } = (req.body || {}) as any;
  const attemptId = String(attempt_id || "").trim();
  const forceRegen = Boolean(force);
  if (!attemptId) return res.status(400).json({ ok: false, error: "attempt_id is required" });

  const { data: anchorAttempt, error: aErr } = await retryTransientApi<any>(
    () => supabaseAdmin
      .from("training_attempts")
      .select("id,room_id,user_id,test_slug")
      .eq("id", attemptId)
      .maybeSingle(),
    { attempts: 2, delayMs: 150 }
  );
  if (aErr || !anchorAttempt) return res.status(404).json({ ok: false, error: "Attempt not found" });

  const { data: specialistMember, error: mErr } = await retryTransientApi<any>(
    () => supabaseAdmin
      .from("training_room_members")
      .select("role")
      .eq("room_id", anchorAttempt.room_id)
      .eq("user_id", user.id)
      .maybeSingle(),
    { attempts: 2, delayMs: 150 }
  );
  if (mErr || !specialistMember || specialistMember.role !== "specialist") {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  if (!forceRegen) {
    const { data: cachedRow } = await retryTransientApi<any>(
      () => supabaseAdmin
        .from("training_attempt_interpretations")
        .select("text")
        .eq("attempt_id", attemptId)
        .eq("kind", "full_profile")
        .maybeSingle(),
      { attempts: 2, delayMs: 150 }
    );
    if (cachedRow?.text) {
      return res.status(200).json({ ok: true, text: String(cachedRow.text), cached: true });
    }
  }

  const sb: any = supabaseAdmin as any;
  let room: any = null;
  let roomErr: any = null;
  ({ data: room, error: roomErr } = await retryTransientApi<any>(
    () => sb.from("training_rooms").select("id,name,analysis_prompt").eq("id", anchorAttempt.room_id).maybeSingle(),
    { attempts: 2, delayMs: 150 }
  ));
  if (roomErr && /analysis_prompt/i.test(roomErr.message || "")) {
    ({ data: room, error: roomErr } = await retryTransientApi<any>(
      () => sb.from("training_rooms").select("id,name").eq("id", anchorAttempt.room_id).maybeSingle(),
      { attempts: 2, delayMs: 150 }
    ));
  }
  if (roomErr || !room) return res.status(404).json({ ok: false, error: "Комната не найдена" });

  const roomName = String(room?.name || "Комната");
  const customPrompt = typeof room?.analysis_prompt === "string" ? String(room.analysis_prompt) : "";

  const { data: participantMember } = await retryTransientApi<any>(
    () => supabaseAdmin
      .from("training_room_members")
      .select("display_name")
      .eq("room_id", anchorAttempt.room_id)
      .eq("user_id", anchorAttempt.user_id)
      .maybeSingle(),
    { attempts: 2, delayMs: 150 }
  );
  const participantName = String(participantMember?.display_name || "Участник");

  const { data: progressRows, error: pErr } = await retryTransientApi<any>(
    () => supabaseAdmin
      .from("training_progress")
      .select("test_slug,attempt_id,completed_at")
      .eq("room_id", anchorAttempt.room_id)
      .eq("user_id", anchorAttempt.user_id)
      .not("completed_at", "is", null),
    { attempts: 2, delayMs: 150 }
  );
  if (pErr) return res.status(500).json({ ok: false, error: pErr.message });

  const progressList = (progressRows || []).filter((r: any) => !!r.attempt_id);
  const attemptIds = progressList.map((r: any) => String(r.attempt_id));
  if (!attemptIds.length) {
    return res.status(400).json({ ok: false, error: "У клиента нет завершённых тестов в этой комнате" });
  }

  const { data: attemptsData, error: atErr } = await retryTransientApi<any>(
    () => supabaseAdmin
      .from("training_attempts")
      .select("id,test_slug,result,created_at")
      .in("id", attemptIds),
    { attempts: 2, delayMs: 150 }
  );
  if (atErr) return res.status(500).json({ ok: false, error: atErr.message });

  const { data: testRows } = await retryTransientApi<any>(
    () => supabaseAdmin
      .from("tests")
      .select("slug,title")
      .in("slug", Array.from(new Set(progressList.map((r: any) => String(r.test_slug))))),
    { attempts: 2, delayMs: 150 }
  );
  const testTitleBySlug = new Map<string, string>();
  for (const row of testRows || []) testTitleBySlug.set(String((row as any).slug), String((row as any).title || (row as any).slug));

  const { data: interpRows } = await retryTransientApi<any>(
    () => supabaseAdmin
      .from("training_attempt_interpretations")
      .select("attempt_id,kind,text")
      .in("attempt_id", attemptIds)
      .in("kind", ["keys_ai"]),
    { attempts: 2, delayMs: 150 }
  );
  const interpByAttempt = new Map<string, string>();
  for (const row of interpRows || []) {
    interpByAttempt.set(String((row as any).attempt_id), String((row as any).text || ""));
  }

  const attemptsById = new Map<string, any>();
  for (const row of attemptsData || []) attemptsById.set(String((row as any).id), row);

  const testsForPrompt = progressList
    .map((p: any) => {
      const attempt = attemptsById.get(String(p.attempt_id));
      if (!attempt) return null;
      const slug = String(p.test_slug || attempt.test_slug || "");
      return {
        slug,
        title: testTitleBySlug.get(slug) || slug,
        created_at: attempt.created_at || p.completed_at || null,
        resultSummary: summarizeResult(attempt.result),
        staffInterpretation: interpByAttempt.get(String(attempt.id)) || "",
      };
    })
    .filter(Boolean) as Array<{ title: string; slug: string; created_at?: string | null; resultSummary: string; staffInterpretation?: string }>;

  if (!testsForPrompt.length) {
    return res.status(400).json({ ok: false, error: "Не удалось собрать данные завершённых тестов" });
  }

  const prompt = buildFullPortraitPrompt({
    roomName,
    participantName,
    customPrompt,
    tests: testsForPrompt,
  });

  try {
    const text = await callDeepseek(prompt);

    await retryTransientApi<any>(
      () => supabaseAdmin
        .from("training_attempt_interpretations")
        .upsert({ attempt_id: attemptId, kind: "full_profile", text }, { onConflict: "attempt_id,kind" }),
      { attempts: 2, delayMs: 150 }
    );

    return res.status(200).json({ ok: true, text, cached: false });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Не удалось собрать полный портрет" });
  }
}
