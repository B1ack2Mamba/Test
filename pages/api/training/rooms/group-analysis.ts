import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { retryTransientApi, setNoStore } from "@/lib/apiHardening";
import { callDeepseekText } from "@/lib/deepseek";

function trimText(s: any, maxLen = 900) {
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
    lines.push(trimText(safeJson(result), 1800));
  }

  if (meta?.dominant) lines.push(`Доминирующее направление: ${String(meta.dominant)}`);
  if (meta?.blend) lines.push(`Смешанный профиль: ${String(meta.blend)}`);
  if (Array.isArray(meta?.leaders) && meta.leaders.length) lines.push(`Лидеры: ${meta.leaders.join(", ")}`);
  if (Array.isArray(meta?.mixedLeaders) && meta.mixedLeaders.length) lines.push(`Смешанные лидеры: ${meta.mixedLeaders.join(", ")}`);

  return lines.join("\n");
}

function buildGroupPrompt(args: {
  roomName: string;
  customPrompt: string;
  participants: Array<{
    name: string;
    tests: Array<{ title: string; slug: string; created_at?: string | null; resultSummary: string; staffInterpretation?: string }>;
  }>;
}) {
  const { roomName, customPrompt, participants } = args;
  const lines: string[] = [];

  lines.push(`Ты — сильный практикующий психолог-аналитик и ведущий группового тренинга.`);
  lines.push(`Нужно сделать групповой анализ по всем участникам комнаты «${roomName}», у которых есть завершённые тесты.`);
  lines.push("");
  lines.push("Жёсткие правила:");
  lines.push("- Пиши по-русски.");
  lines.push("- Не упоминай ИИ, модель, промпт, API, нейросеть.");
  lines.push("- Не ставь диагнозы и не навешивай клинические ярлыки.");
  lines.push("- Не выдумывай данные, которых нет в тестах.");
  lines.push("- Смотри на группу как на систему: сходства, различия, кластеры, напряжения, риски, управленческие выводы.");
  lines.push("- Не ограничивайся средними значениями: выделяй контрасты и заметные выбросы.");
  lines.push("");

  if (customPrompt.trim()) {
    lines.push("Дополнительные инструкции специалиста для группового анализа (учти их максимально точно, если они не противоречат данным):");
    lines.push(customPrompt.trim());
    lines.push("");
  }

  lines.push("Формат ответа:");
  lines.push("1. Ядро группового портрета — 1–2 плотных абзаца.");
  lines.push("2. Повторяющиеся сильные стороны группы — 6–12 пунктов.");
  lines.push("3. Общие риски и уязвимости группы — 6–12 пунктов.");
  lines.push("4. Кластеры / типы участников внутри группы — 3–7 подпунктов с описанием.");
  lines.push("5. Потенциальные линии напряжения, конфликтов или разрыва темпа — 4–8 пунктов.");
  lines.push("6. Кто может требовать отдельного внимания ведущего и почему — 3–8 пунктов.");
  lines.push("7. Практические рекомендации по ведению этой группы — 8–15 пунктов.");
  lines.push("8. Какие темы стоит вынести на обсуждение в группе — 5–10 пунктов.");
  lines.push("");
  lines.push(`В анализе ${participants.length} участников.`);
  lines.push("Данные по участникам:");
  lines.push("");

  participants.forEach((participant, idx) => {
    lines.push(`Участник ${idx + 1}: ${participant.name}`);
    lines.push(`Завершённых тестов: ${participant.tests.length}`);
    participant.tests.forEach((test, tIdx) => {
      lines.push(`Тест ${tIdx + 1}: ${test.title} (${test.slug})`);
      if (test.created_at) lines.push(`Дата попытки: ${test.created_at}`);
      lines.push("Числовой/шкальный результат:");
      lines.push(test.resultSummary);
      if (test.staffInterpretation?.trim()) {
        lines.push("");
        lines.push("Краткая уже имеющаяся расшифровка специалиста:");
        lines.push(trimText(test.staffInterpretation, 900));
      }
      lines.push("");
    });
    lines.push("---");
    lines.push("");
  });

  lines.push("Сделай именно аналитический портрет группы и рекомендации для ведущего, а не механический пересказ карточек людей по очереди.");
  return lines.join("\n");
}

async function callDeepseek(prompt: string): Promise<string> {
  return await callDeepseekText({
    systemPrompt: "Ты помогаешь специалисту собрать групповой психологический анализ по данным нескольких участников и их тестов.",
    userPrompt: prompt,
    temperature: 0.45,
    maxTokens: 5200,
    retries: 2,
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { room_id } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  const sb: any = supabaseAdmin as any;
  const { data: member, error: memberErr } = await retryTransientApi<any>(
    () => supabaseAdmin
      .from("training_room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .maybeSingle(),
    { attempts: 2, delayMs: 150 }
  );
  if (memberErr || !member || member.role !== "specialist") return res.status(403).json({ ok: false, error: "Forbidden" });

  let room: any = null;
  let roomErr: any = null;
  ({ data: room, error: roomErr } = await retryTransientApi<any>(
    () => sb.from("training_rooms").select("id,name,group_analysis_prompt").eq("id", roomId).maybeSingle(),
    { attempts: 2, delayMs: 150 }
  ));
  if (roomErr && /group_analysis_prompt/i.test(roomErr.message || "")) {
    ({ data: room, error: roomErr } = await retryTransientApi<any>(
      () => sb.from("training_rooms").select("id,name").eq("id", roomId).maybeSingle(),
      { attempts: 2, delayMs: 150 }
    ));
  }
  if (roomErr || !room) return res.status(404).json({ ok: false, error: "Комната не найдена" });

  const roomName = String(room?.name || "Комната");
  const customPrompt = typeof room?.group_analysis_prompt === "string" ? String(room.group_analysis_prompt) : "";

  const { data: progressRows, error: progressErr } = await retryTransientApi<any>(
    () => supabaseAdmin
      .from("training_progress")
      .select("room_id,user_id,test_slug,completed_at,attempt_id")
      .eq("room_id", roomId)
      .not("completed_at", "is", null),
    { attempts: 2, delayMs: 150 }
  );
  if (progressErr) return res.status(500).json({ ok: false, error: progressErr.message });

  const completedRows = (progressRows || []).filter((row: any) => !!row?.attempt_id);
  if (!completedRows.length) {
    return res.status(400).json({ ok: false, error: "В этой комнате пока нет завершённых тестов для группового анализа" });
  }

  const userIds = Array.from(new Set(completedRows.map((row: any) => String(row.user_id || "")).filter(Boolean)));
  const attemptIds = Array.from(new Set(completedRows.map((row: any) => String(row.attempt_id || "")).filter(Boolean)));
  const testSlugs = Array.from(new Set(completedRows.map((row: any) => String(row.test_slug || "")).filter(Boolean)));

  const [membersResp, attemptsResp, testsResp, interpsResp] = await Promise.all([
    retryTransientApi<any>(
      () => supabaseAdmin
        .from("training_room_members")
        .select("user_id,display_name,role")
        .eq("room_id", roomId)
        .in("user_id", userIds.length ? userIds : ["__none__"]),
      { attempts: 2, delayMs: 150 }
    ),
    retryTransientApi<any>(
      () => supabaseAdmin
        .from("training_attempts")
        .select("id,user_id,test_slug,result,created_at")
        .in("id", attemptIds.length ? attemptIds : ["__none__"]),
      { attempts: 2, delayMs: 150 }
    ),
    retryTransientApi<any>(
      () => supabaseAdmin
        .from("tests")
        .select("slug,title")
        .in("slug", testSlugs.length ? testSlugs : ["__none__"]),
      { attempts: 2, delayMs: 150 }
    ),
    retryTransientApi<any>(
      () => supabaseAdmin
        .from("training_attempt_interpretations")
        .select("attempt_id,kind,text")
        .in("attempt_id", attemptIds.length ? attemptIds : ["__none__"])
        .in("kind", ["keys_ai"]),
      { attempts: 2, delayMs: 150 }
    ),
  ]);

  const { data: membersData, error: membersErr } = membersResp;
  const { data: attemptsData, error: attemptsErr } = attemptsResp;
  const { data: testsData, error: testsErr } = testsResp;
  const { data: interpsData, error: interpsErr } = interpsResp;
  if (membersErr) return res.status(500).json({ ok: false, error: membersErr.message });
  if (attemptsErr) return res.status(500).json({ ok: false, error: attemptsErr.message });
  if (testsErr) return res.status(500).json({ ok: false, error: testsErr.message });
  if (interpsErr) return res.status(500).json({ ok: false, error: interpsErr.message });

  const memberByUserId = new Map<string, any>();
  for (const row of membersData || []) {
    if (String((row as any)?.role || "") === "participant") {
      memberByUserId.set(String((row as any).user_id), row);
    }
  }

  const testTitleBySlug = new Map<string, string>();
  for (const row of testsData || []) testTitleBySlug.set(String((row as any).slug), String((row as any).title || (row as any).slug));

  const interpByAttempt = new Map<string, string>();
  for (const row of interpsData || []) interpByAttempt.set(String((row as any).attempt_id), String((row as any).text || ""));

  const attemptsById = new Map<string, any>();
  for (const row of attemptsData || []) attemptsById.set(String((row as any).id), row);

  const rowsByUser = new Map<string, any[]>();
  for (const row of completedRows) {
    const uid = String((row as any).user_id || "");
    const list = rowsByUser.get(uid) || [];
    list.push(row);
    rowsByUser.set(uid, list);
  }

  const participants = Array.from(rowsByUser.entries())
    .map(([userId, rows]) => {
      const memberRow = memberByUserId.get(userId);
      const name = String(memberRow?.display_name || "Участник");
      const tests = rows
        .map((row: any) => {
          const attempt = attemptsById.get(String(row.attempt_id));
          if (!attempt) return null;
          const slug = String(row.test_slug || attempt.test_slug || "");
          return {
            slug,
            title: testTitleBySlug.get(slug) || slug,
            created_at: attempt.created_at || row.completed_at || null,
            resultSummary: summarizeResult(attempt.result),
            staffInterpretation: interpByAttempt.get(String(attempt.id)) || "",
          };
        })
        .filter(Boolean) as Array<{ title: string; slug: string; created_at?: string | null; resultSummary: string; staffInterpretation?: string }>;

      tests.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return ta - tb;
      });

      return { name, tests };
    })
    .filter((row) => row.tests.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  if (!participants.length) {
    return res.status(400).json({ ok: false, error: "Нет участников с завершёнными тестами, пригодными для анализа" });
  }

  const prompt = buildGroupPrompt({ roomName, customPrompt, participants });
  const text = await callDeepseek(prompt);

  return res.status(200).json({
    ok: true,
    text,
    participant_count: participants.length,
    room: {
      id: roomId,
      name: roomName,
      group_analysis_prompt: customPrompt,
    },
  });
}
