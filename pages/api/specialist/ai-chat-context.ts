import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { isSpecialistUser } from "@/lib/specialist";
import { setNoStore } from "@/lib/apiHardening";

function compactText(input: any, max = 12_000) {
  const text = String(input || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}\n\n[Контекст обрезан.]` : text;
}

function resultSummary(result: any) {
  if (!result || typeof result !== "object") return "";
  const rows = Array.isArray(result.ranked) ? result.ranked : [];
  if (rows.length) {
    return rows
      .map((row: any) => {
        const style = String(row?.style || row?.tag || "").trim();
        const count = row?.count !== undefined ? `: ${row.count}` : "";
        const percent = row?.percent !== undefined ? ` (${row.percent}%)` : "";
        const level = row?.level ? `, ${row.level}` : "";
        return `${style}${count}${percent}${level}`;
      })
      .filter(Boolean)
      .slice(0, 8)
      .join("; ");
  }

  const counts = result.counts && typeof result.counts === "object" ? result.counts : null;
  if (counts) {
    return Object.entries(counts)
      .slice(0, 12)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("; ");
  }

  return compactText(JSON.stringify(result), 2000);
}

function attemptContext(args: { roomName: string; participantName: string; testTitle: string; attempt: any; interpretation?: string }) {
  const lines = [
    `Комната: ${args.roomName}`,
    `Участник: ${args.participantName}`,
    `Тест: ${args.testTitle}`,
    `Дата попытки: ${args.attempt?.created_at || ""}`,
    "",
    "Итоги теста:",
    resultSummary(args.attempt?.result) || "Нет числовой сводки.",
  ];
  if (args.interpretation) {
    lines.push("", "Готовая интерпретация:", args.interpretation);
  }
  return compactText(lines.join("\n"));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: "Forbidden" });

  const sb: any = auth.supabaseAdmin as any;
  const { data: memberships, error: memberError } = await sb
    .from("training_room_members")
    .select("room_id")
    .eq("user_id", auth.user.id)
    .eq("role", "specialist");

  if (memberError) return res.status(500).json({ ok: false, error: memberError.message });

  const roomIds = Array.from(new Set((memberships || []).map((m: any) => String(m.room_id)).filter(Boolean))).slice(0, 50);
  if (!roomIds.length) return res.status(200).json({ ok: true, rooms: [] });

  const [roomsResp, membersResp, attemptsResp] = await Promise.all([
    sb.from("training_rooms").select("id,name,is_active,created_at").in("id", roomIds).order("created_at", { ascending: false }),
    sb.from("training_room_members").select("room_id,user_id,display_name,role,joined_at,last_seen").in("room_id", roomIds).order("joined_at", { ascending: true }),
    sb
      .from("training_attempts")
      .select("id,room_id,user_id,test_slug,result,created_at")
      .in("room_id", roomIds)
      .order("created_at", { ascending: false })
      .limit(400),
  ]);

  if (roomsResp.error) return res.status(500).json({ ok: false, error: roomsResp.error.message });
  if (membersResp.error) return res.status(500).json({ ok: false, error: membersResp.error.message });
  if (attemptsResp.error) return res.status(500).json({ ok: false, error: attemptsResp.error.message });

  const attempts = attemptsResp.data || [];
  const slugs = Array.from(new Set(attempts.map((a: any) => String(a.test_slug)).filter(Boolean)));
  const attemptIds = attempts.map((a: any) => String(a.id)).filter(Boolean);

  const [testsResp, interpResp] = await Promise.all([
    slugs.length
      ? sb.from("tests").select("slug,title").in("slug", slugs)
      : Promise.resolve({ data: [], error: null }),
    attemptIds.length
      ? sb.from("training_attempt_interpretations").select("attempt_id,kind,text,created_at").in("attempt_id", attemptIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (testsResp.error) return res.status(500).json({ ok: false, error: testsResp.error.message });
  if (interpResp.error) return res.status(500).json({ ok: false, error: interpResp.error.message });

  const testTitleBySlug = new Map<string, string>();
  for (const test of testsResp.data || []) testTitleBySlug.set(String(test.slug), String(test.title || test.slug));

  const interpByAttempt = new Map<string, string>();
  for (const row of interpResp.data || []) {
    const id = String(row.attempt_id);
    if (!interpByAttempt.has(id)) interpByAttempt.set(id, compactText(row.text, 5000));
  }

  const membersByRoom = new Map<string, any[]>();
  for (const member of membersResp.data || []) {
    const roomId = String(member.room_id);
    membersByRoom.set(roomId, [...(membersByRoom.get(roomId) || []), member]);
  }

  const attemptsByRoomUser = new Map<string, any[]>();
  for (const attempt of attempts) {
    const key = `${attempt.room_id}:${attempt.user_id}`;
    attemptsByRoomUser.set(key, [...(attemptsByRoomUser.get(key) || []), attempt]);
  }

  const rooms = (roomsResp.data || []).map((room: any) => {
    const roomId = String(room.id);
    const members = (membersByRoom.get(roomId) || []).filter((m) => m.role === "participant");
    const participants = members.map((member: any) => {
      const participantAttempts = (attemptsByRoomUser.get(`${roomId}:${member.user_id}`) || []).slice(0, 12);
      const mappedAttempts = participantAttempts.map((attempt: any) => {
        const testTitle = testTitleBySlug.get(String(attempt.test_slug)) || String(attempt.test_slug);
        const interpretation = interpByAttempt.get(String(attempt.id)) || "";
        return {
          id: attempt.id,
          test_slug: attempt.test_slug,
          test_title: testTitle,
          created_at: attempt.created_at,
          summary: resultSummary(attempt.result),
          context_text: attemptContext({
            roomName: room.name,
            participantName: member.display_name,
            testTitle,
            attempt,
            interpretation,
          }),
        };
      });

      const contextLines = [
        `Комната: ${room.name}`,
        `Участник: ${member.display_name}`,
        `Попыток: ${mappedAttempts.length}`,
        "",
        ...mappedAttempts.map((attempt: any, idx: number) => `${idx + 1}. ${attempt.test_title} (${attempt.created_at})\n${attempt.summary || "Нет сводки."}`),
      ];

      return {
        user_id: member.user_id,
        display_name: member.display_name,
        joined_at: member.joined_at,
        last_seen: member.last_seen,
        attempts: mappedAttempts,
        context_text: compactText(contextLines.join("\n\n")),
      };
    });

    const roomContextLines = [
      `Комната: ${room.name}`,
      `Участников: ${participants.length}`,
      "",
      ...participants.map((participant: any, idx: number) => {
        const latest = participant.attempts.slice(0, 4).map((attempt: any) => `${attempt.test_title}: ${attempt.summary || "нет сводки"}`).join("\n");
        return `${idx + 1}. ${participant.display_name}\n${latest || "Нет завершённых тестов."}`;
      }),
    ];

    return {
      id: room.id,
      name: room.name,
      is_active: room.is_active,
      created_at: room.created_at,
      participants,
      context_text: compactText(roomContextLines.join("\n\n")),
    };
  });

  return res.status(200).json({ ok: true, rooms });
}
