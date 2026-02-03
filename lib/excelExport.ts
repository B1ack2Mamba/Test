import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoreResult } from "@/lib/score";

type RoomMember = {
  user_id: string;
  display_name: string | null;
  role: string;
};

type AttemptRow = {
  id: string;
  user_id: string;
  test_slug: string;
  answers: any;
  result: any;
  created_at: string;
};

function safeName(name: string) {
  const s = String(name || "").trim();
  if (!s) return "room";
  // Keep it filesystem-safe-ish
  return s.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
}

function latestAttemptsByUserTest(attempts: AttemptRow[]) {
  const map = new Map<string, AttemptRow>();
  for (const a of attempts) {
    const key = `${a.user_id}::${a.test_slug}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, a);
      continue;
    }
    const ta = new Date(a.created_at).getTime();
    const tp = new Date(prev.created_at).getTime();
    if (ta >= tp) map.set(key, a);
  }
  return map;
}

function getCount(result: ScoreResult | any, key: string) {
  const n = (result as any)?.counts?.[key];
  const x = Number(n);
  return Number.isFinite(x) ? x : "";
}

function getForcedPairCount(result: ScoreResult | any, tag: string) {
  return getCount(result, tag);
}

function getMotivationCount(result: ScoreResult | any, factor: string) {
  return getCount(result, factor);
}

export async function buildRoomExcel({
  roomId,
  roomName,
  members,
  attempts,
}: {
  roomId: string;
  roomName: string;
  members: RoomMember[];
  attempts: AttemptRow[];
}): Promise<{ filename: string; buffer: Buffer }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "tests-platform";
  wb.created = new Date();

  // ===================== Sheet: СВОД =====================
  const ws = wb.addWorksheet("СВОД", {
    views: [{ state: "frozen", ySplit: 2 }],
  });

  // Header row 1 with merged groups
  ws.addRow([
    "",
    "",
    "структограмма",
    "",
    "",
    "мотивационные карты",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "переговор стиль",
    "",
    "",
    "",
    "",
  ]);
  ws.mergeCells("C1:E1");
  ws.mergeCells("F1:O1");
  ws.mergeCells("P1:T1");

  ws.addRow([
    "№",
    "ФИО",
    "зеленый",
    "красный",
    "синий",
    "А. Финансы / зарплата",
    "деятельность администрации",
    "отношения в коллективе",
    "признание со стороны других",
    "С. Ответственность",
    "Е. Карьера / рост",
    "F. Достижения",
    "Н. Содержание / интерес",
    "гигиенические",
    "мотивационные",
    "Соперничество",
    "Сотрудничество",
    "Компромисс",
    "Избегание",
    "Приспособление",
  ]);

  // Basic styling for headers
  for (const r of [1, 2]) {
    const row = ws.getRow(r);
    row.font = { bold: true };
    row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    row.height = r === 1 ? 18 : 32;
  }

  // Column widths
  const widths = [5, 34, 10, 10, 10, 16, 20, 20, 22, 16, 16, 14, 18, 14, 14, 14, 16, 14, 14, 18];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // Data preparation
  const participants = (members || []).filter((m) => m.role !== "specialist");
  const attemptsMap = latestAttemptsByUserTest(attempts || []);

  const rowStart = 3;
  let rowIdx = 0;

  for (const m of participants) {
    rowIdx += 1;
    const displayName = (m.display_name || "").trim() || m.user_id;

    // locate attempts for known tests by kind
    let color: ScoreResult | null = null;
    let motiv: ScoreResult | null = null;
    let nego: ScoreResult | null = null;

    // pick latest per slug then check kind
    for (const [key, att] of attemptsMap.entries()) {
      const [uid] = key.split("::");
      if (uid !== m.user_id) continue;
      const r = att.result as any;
      if (!r || typeof r !== "object") continue;
      if (r.kind === "color_types_v1") color = r as any;
      if (r.kind === "pair_sum5_v1") motiv = r as any;
      if (r.kind === "forced_pair_v1") nego = r as any;
    }

    const excelRow = ws.addRow([
      rowIdx,
      displayName,
      color ? getCount(color, "green") : "",
      color ? getCount(color, "red") : "",
      color ? getCount(color, "blue") : "",
      motiv ? getMotivationCount(motiv, "A") : "", // salary/finance
      motiv ? getMotivationCount(motiv, "D") : "", // admin
      motiv ? getMotivationCount(motiv, "I") : "", // relations in team
      motiv ? getMotivationCount(motiv, "B") : "", // recognition
      motiv ? getMotivationCount(motiv, "C") : "", // responsibility
      motiv ? getMotivationCount(motiv, "E") : "", // career/growth
      motiv ? getMotivationCount(motiv, "F") : "", // achievements
      motiv ? getMotivationCount(motiv, "H") : "", // interest/content
      "", // hygiene formula
      "", // motivators formula
      nego ? getForcedPairCount(nego, "A") : "",
      nego ? getForcedPairCount(nego, "B") : "",
      nego ? getForcedPairCount(nego, "C") : "",
      nego ? getForcedPairCount(nego, "D") : "",
      nego ? getForcedPairCount(nego, "E") : "",
    ]);

    const r = excelRow.number;

    // formulas matching Murmansk template
    ws.getCell(`N${r}`).value = { formula: `SUM(F${r}:H${r})` };
    ws.getCell(`O${r}`).value = { formula: `SUM(I${r}:M${r})` };

    // alignments for row
    excelRow.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    ws.getCell(`B${r}`).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }

  // ===================== Sheet: ОТВЕТЫ (RAW) =====================
  const raw = wb.addWorksheet("ОТВЕТЫ_RAW", { views: [{ state: "frozen", ySplit: 1 }] });
  raw.addRow(["ФИО", "user_id", "test_slug", "attempt_id", "created_at", "answers_json", "result_json"]);
  raw.getRow(1).font = { bold: true };
  raw.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  raw.getColumn(1).width = 34;
  raw.getColumn(2).width = 38;
  raw.getColumn(3).width = 20;
  raw.getColumn(4).width = 38;
  raw.getColumn(5).width = 22;
  raw.getColumn(6).width = 70;
  raw.getColumn(7).width = 70;

  const nameByUser = new Map(participants.map((m) => [m.user_id, (m.display_name || "").trim() || m.user_id]));
  for (const a of (attempts || [])) {
    const name = nameByUser.get(a.user_id) || a.user_id;
    raw.addRow([
      name,
      a.user_id,
      a.test_slug,
      a.id,
      a.created_at,
      JSON.stringify(a.answers ?? {}),
      JSON.stringify(a.result ?? {}),
    ]);
  }

  const filename = `${safeName(roomName)}_${roomId.slice(0, 8)}.xlsx`;
  const buf = await wb.xlsx.writeBuffer();
  return { filename, buffer: Buffer.from(buf) };
}
