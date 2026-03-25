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
  lines.push(`Ты — сильный практикующий психолог-аналитик и ведущий тренинга.`);
  lines.push(`Нужно составить групповой аналитический вывод по участникам комнаты «${roomName}».`);
  lines.push(`Участников с завершёнными тестами: ${participants.length}.`);
  lines.push("");
  lines.push("Жёсткие правила:");
  lines.push("- Пиши по-русски.");
  lines.push("- Не упоминай ИИ, модель, промпт, API, нейросеть.");
  lines.push("- Не придумывай факты, которых нет в данных.");
  lines.push("- Не ставь клинические диагнозы.");
  lines.push("- Показывай как общие групповые тенденции, так и заметные различия между людьми.");
  lines.push("- Если данных мало, честно укажи ограничения.");
  lines.push("");

  if (customPrompt.trim()) {
    lines.push("Дополнительные инструкции специалиста для группового анализа (учти их максимально точно, если они не противоречат данным):");
    lines.push(customPrompt.trim());
    lines.push("");
  }

  lines.push("Формат ответа:");
  lines.push("1. Краткое ядро группового профиля — 1 абзац на 6–10 предложений.");
  lines.push("2. Общие сильные стороны группы — 6–10 пунктов.");
  lines.push("3. Общие риски и уязвимости группы — 5–9 пунктов.");
  lines.push("4. Различия между участниками / подгруппы / напряжения — 4–8 пунктов.");
  lines.push("5. Рекомендации по работе с этой группой для специалиста или руководителя — 7–12 пунктов.");
  lines.push("6. Вопросы и темы, которые стоит поднять на групповом обсуждении — 5–8 пунктов.");
  lines.push("");
  lines.push("Данные по участникам:");
  lines.push("");

  participants.forEach((participant, idx) => {
    lines.push(`Участник ${idx + 1}: ${participant.name}`);
    participant.tests.forEach((t, testIdx) => {
      lines.push(`Тест ${testIdx + 1}: ${t.title} (${t.slug})`);
      if (t.created_at) lines.push(`Дата попытки: ${t.created_at}`);
      lines.push("Числовой/шкальный результат:");
      lines.push(t.resultSummary);
      if (t.staffInterpretation?.trim()) {
        lines.push("");
        lines.push("Краткая уже имеющаяся расшифровка специалиста:");
        lines.push(trimText(t.staffInterpretation, 700));
      }
      lines.push("");
    });
    lines.push("---");
    lines.push("");
  });

  lines.push("Собери именно общую картину по группе и различиям между людьми, а не набор отдельных мини-портретов.");
  return lines.join("\n");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  if (!isSpecialistUser(user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const roomId = String((req.body || {}).room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  const { data: specialistMember, error: mErr } = await retryTransientApi<any>(
    () => supabaseAdmin.from("training_room_members").select("role").eq("room_id", roomId).eq("user_id", user.id).maybeSingle(),
    { attempts: 2, delayMs: 150 }
  );
  if (mErr || !specialistMember || specialistMember.role !== "specialist") {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  const sb: any = supabaseAdmin as any;
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

  const { data: progressRows, error: pErr } = await retryTransientApi<any>(
    () => supabaseAdmin
      .from("training_progress")
      .select("user_id,test_slug,attempt_id,completed_at")
      .eq("room_id", roomId)
      .not("completed_at", "is", null),
    { attempts: 2, delayMs: 150 }
  );
  if (pErr) return res.status(500).json({ ok: false, error: pErr.message });

  const progressList = (progressRows || []).filter((r: any) => !!r.attempt_id);
  if (!progressList.length) {
    return res.status(400).json({ ok: false, error: "В комнате пока нет завершённых тестов" });
  }

  const userIds = Array.from(new Set(progressList.map((r: any) => String(r.user_id))));
  const attemptIds = Array.from(new Set(progressList.map((r: any) => String(r.attempt_id))));
  const slugs = Array.from(new Set(progressList.map((r: any) => String(r.test_slug))));

  const [membersResp, attemptsResp, testsResp, interpResp] = await Promise.all([
    retryTransientApi<any>(() => supabaseAdmin.from("training_room_members").select("user_id,display_name,role").eq("room_id", roomId).in("user_id", userIds), { attempts: 2, delayMs: 150 }),
    retryTransientApi<any>(() => supabaseAdmin.from("training_attempts").select("id,user_id,test_slug,result,created_at").in("id", attemptIds), { attempts: 2, delayMs: 150 }),
    retryTransientApi<any>(() => supabaseAdmin.from("tests").select("slug,title").in("slug", slugs), { attempts: 2, delayMs: 150 }),
    retryTransientApi<any>(() => supabaseAdmin.from("training_attempt_interpretations").select("attempt_id,kind,text").in("attempt_id", attemptIds).in("kind", ["keys_ai"]), { attempts: 2, delayMs: 150 }),
  ]);

  if (membersResp.error) return res.status(500).json({ ok: false, error: membersResp.error.message });
  if (attemptsResp.error) return res.status(500).json({ ok: false, error: attemptsResp.error.message });
  if (testsResp.error) return res.status(500).json({ ok: false, error: testsResp.error.message });
  if (interpResp.error) return res.status(500).json({ ok: false, error: interpResp.error.message });

  const memberNameByUser = new Map<string, string>();
  for (const row of membersResp.data || []) {
    if (String((row as any).role || "") === "participant") {
      memberNameByUser.set(String((row as any).user_id), String((row as any).display_name || "Участник"));
    }
  }
  const attemptsById = new Map<string, any>();
  for (const row of attemptsResp.data || []) attemptsById.set(String((row as any).id), row);
  const testTitleBySlug = new Map<string, string>();
  for (const row of testsResp.data || []) testTitleBySlug.set(String((row as any).slug), String((row as any).title || (row as any).slug));
  const interpByAttempt = new Map<string, string>();
  for (const row of interpResp.data || []) interpByAttempt.set(String((row as any).attempt_id), String((row as any).text || ""));

  const participantMap = new Map<string, { name: string; tests: Array<{ title: string; slug: string; created_at?: string | null; resultSummary: string; staffInterpretation?: string }> }>();

  for (const row of progressList) {
    const userId = String((row as any).user_id);
    const attempt = attemptsById.get(String((row as any).attempt_id));
    if (!attempt) continue;
    const slug = String((row as any).test_slug || attempt.test_slug || "");
    const participant = participantMap.get(userId) || {
      name: memberNameByUser.get(userId) || "Участник",
      tests: [],
    };
    participant.tests.push({
      slug,
      title: testTitleBySlug.get(slug) || slug,
      created_at: attempt.created_at || (row as any).completed_at || null,
      resultSummary: summarizeResult(attempt.result),
      staffInterpretation: interpByAttempt.get(String(attempt.id)) || "",
    });
    participantMap.set(userId, participant);
  }

  const participants = Array.from(participantMap.values())
    .filter((p) => p.tests.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  if (!participants.length) {
    return res.status(400).json({ ok: false, error: "Не удалось собрать данные по участникам комнаты" });
  }

  const prompt = buildGroupPrompt({
    roomName: String(room?.name || "Комната"),
    customPrompt: typeof room?.group_analysis_prompt === "string" ? String(room.group_analysis_prompt) : "",
    participants,
  });

  try {
    const text = await callDeepseekText({
      system: "Ты помогаешь специалисту собрать целостный групповой психологический анализ по данным нескольких участников и тестов.",
      user: prompt,
      temperature: 0.45,
      maxTokensChat: 3600,
      maxTokensReasoner: 20000,
    });
    return res.status(200).json({ ok: true, text, participant_count: participants.length });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Не удалось собрать групповой анализ" });
  }
}
