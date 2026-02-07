import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/serverAuth";
import { ensureRoomTests, sortRoomTests } from "@/lib/trainingRoomTests";
import { loadTestJsonBySlugAdmin } from "@/lib/loadTestAdmin";

function colToLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

type ColDef = {
  key: string;
  header2: string;
  group: string;
  width?: number;
  test_slug?: string;
  fromResult?: (result: any) => any;
  formula?: (rowNumber: number, keyToColLetter: Record<string, string>) => string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supabaseAdmin } = auth;

  const { room_id } = (req.body || {}) as any;
  const roomId = String(room_id || "").trim();
  if (!roomId) return res.status(400).json({ ok: false, error: "room_id is required" });

  // Must be specialist in the room.
  const { data: selfMem, error: selfMemErr } = await supabaseAdmin
    .from("training_room_members")
    .select("id,role")
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (selfMemErr || !selfMem || String((selfMem as any).role) !== "specialist") {
    return res.status(403).json({ ok: false, error: "Нет доступа" });
  }

  // Room name
  const { data: room, error: roomErr } = await supabaseAdmin
    .from("training_rooms")
    .select("id,name")
    .eq("id", roomId)
    .maybeSingle();
  if (roomErr || !room) return res.status(404).json({ ok: false, error: "Комната не найдена" });
  const roomName = String((room as any).name || "Комната");

  // Room tests (ordered)
  let roomTests: any[] = [];
  try {
    roomTests = sortRoomTests(await ensureRoomTests(supabaseAdmin as any, roomId)) as any[];
  } catch {
    const { data } = await supabaseAdmin
      .from("training_room_tests")
      .select("room_id,test_slug,is_enabled,sort_order,required,deadline_at")
      .eq("room_id", roomId)
      .order("sort_order", { ascending: true });
    roomTests = (data ?? []) as any[];
  }

  const testSlugs = roomTests.map((r) => String(r.test_slug));

  // Participants
  const { data: membersData, error: memErr } = await supabaseAdmin
    .from("training_room_members")
    .select("user_id,display_name,role,joined_at")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (memErr) return res.status(500).json({ ok: false, error: memErr.message });

  const participants = (membersData ?? []).filter((m: any) => String(m.role) === "participant") as any[];
  const participantIds = participants.map((m) => String(m.user_id));

  // Progress and attempts
  // NOTE: user_id is UUID in our schema. Do NOT use placeholder values like "__none__" in .in(),
  // otherwise Postgres will throw: invalid input syntax for type uuid.
  const progressData: any[] = [];
  if (participantIds.length && testSlugs.length) {
    const { data, error: progErr } = await supabaseAdmin
      .from("training_progress")
      .select("room_id,user_id,test_slug,attempt_id")
      .eq("room_id", roomId)
      .in("user_id", participantIds)
      .in("test_slug", testSlugs);
    if (progErr) return res.status(500).json({ ok: false, error: progErr.message });
    progressData.push(...(data ?? []));
  }

  const attemptIds = (progressData ?? []).map((p: any) => p.attempt_id).filter(Boolean) as string[];
  const { data: attemptsData, error: attErr } = attemptIds.length
    ? await supabaseAdmin
        .from("training_attempts")
        .select("id,user_id,test_slug,result")
        .in("id", attemptIds)
    : ({ data: [], error: null } as any);
  if (attErr) return res.status(500).json({ ok: false, error: attErr.message });

  const attemptById = new Map<string, any>();
  for (const a of attemptsData ?? []) attemptById.set(String((a as any).id), a);

  const resultByUserSlug = new Map<string, any>();
  for (const p of progressData ?? []) {
    if (!p.attempt_id) continue;
    const a = attemptById.get(String(p.attempt_id));
    if (!a) continue;
    resultByUserSlug.set(`${p.user_id}:${p.test_slug}`, a.result);
  }

  // Load test JSONs (for dynamic schemas)
  const testsJson: Record<string, any> = {};
  await Promise.all(
    testSlugs.map(async (slug) => {
      try {
        const t = await loadTestJsonBySlugAdmin(supabaseAdmin as any, slug);
        if (t) testsJson[slug] = t;
      } catch {
        // ignore
      }
    })
  );

  // Build column definitions in "Murmansk-like" style: grouped headers + expandable.
  const cols: ColDef[] = [
    { key: "idx", header2: "№", group: "", width: 5 },
    { key: "name", header2: "ФИО", group: "", width: 30 },
  ];

  const groupRanges: { title: string; startCol: number; endCol: number }[] = [];

  const pushGroup = (title: string, sub: ColDef[]) => {
    const start = cols.length + 1; // 1-based in sheet
    cols.push(...sub);
    const end = cols.length;
    groupRanges.push({ title, startCol: start, endCol: end });
  };

  // Helper: try infer schema from test json or results.
  for (const rt of roomTests) {
    const slug = String(rt.test_slug);
    const t = testsJson[slug];
    const title = String(t?.title || slug);
    const type = String(t?.type || "");

    // Color types
    if (type === "color_types_v1" || slug === "color-types") {
      pushGroup("структограмма", [
        { key: `${slug}:green`, header2: "Зелёный", group: "структограмма", test_slug: slug, width: 12, fromResult: (r) => r?.counts?.green ?? null },
        { key: `${slug}:red`, header2: "Красный", group: "структограмма", test_slug: slug, width: 12, fromResult: (r) => r?.counts?.red ?? null },
        { key: `${slug}:blue`, header2: "Синий", group: "структограмма", test_slug: slug, width: 12, fromResult: (r) => r?.counts?.blue ?? null },
      ]);
      continue;
    }

    // Motivation cards (pair split)
    if (type === "pair_sum5_v1" || type === "pair_split_v1") {
      const factors = Array.isArray(t?.scoring?.factors) ? (t.scoring.factors as string[]) : [];
      const factorToName = (t?.scoring?.factor_to_name || {}) as Record<string, string>;

      // Nice order (if it's the classic 8-factor motivation set)
      const desiredOrder = ["A", "D", "I", "B", "C", "E", "F", "H"];
      const ordered = desiredOrder.every((x) => factors.includes(x)) ? desiredOrder : factors;

      const sub: ColDef[] = ordered.map((f) => ({
        key: `${slug}:${f}`,
        // Match the original key/table header style.
        header2: `Фактор "${f}"\n${factorToName[f] || f}`,
        group: title,
        test_slug: slug,
        width: 18,
        fromResult: (r) => (r?.meta?.norm35ByFactor?.[f] ?? r?.counts?.[f] ?? null),
      }));

      // Optional sums if groups are present.
      const groups = (t?.scoring?.groups || {}) as any;
      const gHyg = Array.isArray(groups.hygiene) ? (groups.hygiene as string[]) : [];
      const gMot = Array.isArray(groups.motivators) ? (groups.motivators as string[]) : [];

      if (gHyg.length) {
        sub.push({
          key: `${slug}:sum_hygiene`,
          header2: "гигиенические",
          group: title,
          test_slug: slug,
          width: 16,
          fromResult: (r) => {
            const toNum = (x: any) => (typeof x === "number" && isFinite(x) ? x : Number(x) || 0);
            return gHyg.reduce((acc: number, f: string) => acc + toNum(r?.meta?.norm35ByFactor?.[f] ?? r?.counts?.[f]), 0);
          },
        });
      }
      if (gMot.length) {
        sub.push({
          key: `${slug}:sum_motivators`,
          header2: "мотивационные",
          group: title,
          test_slug: slug,
          width: 16,
          fromResult: (r) => {
            const toNum = (x: any) => (typeof x === "number" && isFinite(x) ? x : Number(x) || 0);
            return gMot.reduce((acc: number, f: string) => acc + toNum(r?.meta?.norm35ByFactor?.[f] ?? r?.counts?.[f]), 0);
          },
        });
      }

      pushGroup(title, sub);
      continue;
    }

    // Negotiation style (forced pair)
    if (type === "forced_pair" || type === "forced_pair_v1") {
      const baseTags = Array.isArray(t?.scoring?.tags) ? (t.scoring.tags as string[]) : [];
      const preferred = ["A", "B", "C", "D", "E"];
      const tags = preferred.filter((x) => baseTags.includes(x));
      const tagToStyle = (t?.scoring?.tag_to_style || {}) as Record<string, string>;
      const sub: ColDef[] = tags.map((tag) => ({
        key: `${slug}:${tag}`,
        header2: tagToStyle[tag] || tag,
        group: title,
        test_slug: slug,
        width: 18,
        fromResult: (r) => r?.counts?.[tag] ?? null,
      }));
      pushGroup(title, sub);
      continue;
    }

    // USK
    if (type === "usk_v1" || slug === "usk") {
      const scales = Array.isArray(t?.scoring?.scales) ? (t.scoring.scales as string[]) : [];
      const scaleToName = (t?.scoring?.scale_to_name || {}) as Record<string, string>;
      const sub: ColDef[] = scales.map((s) => ({
        key: `${slug}:${s}`,
        header2: scaleToName[s] || s,
        group: title,
        test_slug: slug,
        width: 22,
        fromResult: (r) => r?.counts?.[s] ?? null,
      }));
      pushGroup(title, sub);
      continue;
    }

    // 16PF
    if (type === "16pf_v1" || slug === "16pf") {
      const factors = Array.isArray(t?.scoring?.factors)
        ? (t.scoring.factors as string[])
        : ["A","B","C","E","F","G","H","I","L","M","N","O","Q1","Q2","Q3","Q4"];
      const factorToName = (t?.scoring?.factor_to_name || {}) as Record<string, string>;

      const sub: ColDef[] = [];
      for (const f of factors) {
        sub.push({
          key: `${slug}:${f}`,
          header2: `${f}. ${factorToName[f] || f}`,
          group: title,
          test_slug: slug,
          width: 18,
          fromResult: (r) => r?.counts?.[f] ?? null,
        });
        sub.push({
          key: `${slug}:${f}:level`,
          header2: `${f} уровень`,
          group: title,
          test_slug: slug,
          width: 16,
          fromResult: (r) => {
            const arr = Array.isArray(r?.ranked) ? (r.ranked as any[]) : [];
            const row = arr.find((x) => String((x as any)?.tag) === String(f));
            return (row as any)?.level ?? null;
          },
        });
      }

      pushGroup(title, sub);
      continue;
    }

    // Generic: expand by observed result keys (or fallback to 1 column)
    const observedKeys = new Set<string>();
    for (const m of participants) {
      const r = resultByUserSlug.get(`${m.user_id}:${slug}`);
      const counts = r?.counts;
      if (counts && typeof counts === "object") {
        for (const k of Object.keys(counts)) observedKeys.add(k);
      }
    }
    const keys = [...observedKeys].sort((a, b) => a.localeCompare(b));
    if (keys.length) {
      pushGroup(title, keys.map((k) => ({
        key: `${slug}:${k}`,
        header2: k,
        group: title,
        test_slug: slug,
        width: 14,
        fromResult: (r) => r?.counts?.[k] ?? null,
      })));
    } else {
      pushGroup(title, [{
        key: `${slug}:score`,
        header2: "результат",
        group: title,
        test_slug: slug,
        width: 14,
        fromResult: (r) => (r?.ranked?.[0]?.count ?? r?.total ?? null),
      }]);
    }
  }

  // Prepare col-letter mapping
  const keyToColLetter: Record<string, string> = {};
  cols.forEach((c, idx) => {
    keyToColLetter[c.key] = colToLetter(idx + 1); // 1-based
  });

  // Visual separators: make it easier to read when there are many scales/columns.
  // - Thick vertical border after the "ФИО" column
  // - Thick vertical border after each grouped test block
  const sepCols = new Set<number>([2, ...groupRanges.map((g) => g.endCol)]);

  const styleFor = (
    base: "sHeader" | "sCell" | "sName",
    colIndex: number,
    altRow: boolean
  ) => {
    const sep = sepCols.has(colIndex);
    if (base === "sHeader") return sep ? "sHeaderSep" : "sHeader";
    if (base === "sName") {
      if (altRow) return sep ? "sNameAltSep" : "sNameAlt";
      return sep ? "sNameSep" : "sName";
    }
    // sCell
    if (altRow) return sep ? "sCellAltSep" : "sCellAlt";
    return sep ? "sCellSep" : "sCell";
  };

  // ===== Excel export without external deps (SpreadsheetML 2003) =====
  const xmlEscape = (v: string) =>
    v
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const isNum = (v: any) => typeof v === "number" && isFinite(v);

  const cellXml = (
    value: any,
    styleId: string,
    opts?: { index?: number; mergeAcross?: number; type?: "String" | "Number" }
  ) => {
    const attrs: string[] = [`ss:StyleID="${styleId}"`];
    if (opts?.index) attrs.push(`ss:Index="${opts.index}"`);
    if (typeof opts?.mergeAcross === "number" && opts.mergeAcross > 0) attrs.push(`ss:MergeAcross="${opts.mergeAcross}"`);

    if (value === null || value === undefined || value === "") {
      return `<Cell ${attrs.join(" ")} />`;
    }

    const t = opts?.type || (isNum(value) ? "Number" : "String");
    const vv = t === "Number" ? String(Number(value)) : xmlEscape(String(value));
    return `<Cell ${attrs.join(" ")}><Data ss:Type="${t}">${vv}</Data></Cell>`;
  };

  const rowXml = (cells: string[]) => `<Row>${cells.join("")}</Row>`;

  // NOTE: SpreadsheetML "WorksheetOptions" is optional but can be fragile across Excel versions.
  // To maximize compatibility (and avoid "file is corrupted" warnings), we omit it.
  const sheetOptionsXml = (_freezeRows: number, _freezeCols: number) => "";

  const sheetColumnsXml = (defs: { width?: number }[]) => {
    return defs
      .map((c) => {
        const w = typeof c.width === "number" ? Math.max(30, Math.round(c.width * 7)) : 90;
        return `<Column ss:AutoFitWidth="0" ss:Width="${w}" />`;
      })
      .join("");
  };

  const buildMurmanskSheetXml = (name: string, rowsArr: any[], freezeRows = 2, freezeCols = 2) => {
    // Header row1 (groups with merges)
    const r1: string[] = [];
    r1.push(cellXml("", styleFor("sHeader", 1, false), { index: 1, type: "String" }));
    r1.push(cellXml("", styleFor("sHeader", 2, false), { index: 2, type: "String" }));

    for (const g of groupRanges) {
      const mergeAcross = Math.max(0, g.endCol - g.startCol);
      // Use the group's end column to decide whether we need a thick separator border.
      r1.push(cellXml(g.title, styleFor("sHeader", g.endCol, false), { index: g.startCol, mergeAcross, type: "String" }));
    }

    // Header row2 (col names)
    const r2: string[] = [];
    for (let i = 0; i < cols.length; i++) {
      const colIndex = i + 1;
      r2.push(cellXml(cols[i].header2, styleFor("sHeader", colIndex, false), { type: "String" }));
    }

    // Data rows
    const dataRows: string[] = [];
    let idx = 0;
    for (const r of rowsArr) {
      idx++;
      const altRow = idx % 2 === 0;
      const rowCells: string[] = [];
      rowCells.push(cellXml(r.idx ?? idx, styleFor("sCell", 1, altRow), { type: "Number" }));
      rowCells.push(cellXml(r.name || "", styleFor("sName", 2, altRow), { type: "String" }));

      for (let c = 3; c <= cols.length; c++) {
        const def = cols[c - 1];
        const result = def.test_slug ? resultByUserSlug.get(`${r.user_id}:${def.test_slug}`) : null;
        const v = def.fromResult ? def.fromResult(result) : null;
        rowCells.push(cellXml(v, styleFor("sCell", c, altRow)));
      }

      dataRows.push(rowXml(rowCells));
    }

    const expandedCols = cols.length;
    const expandedRows = 2 + rowsArr.length;

    return `
  <Worksheet ss:Name="${xmlEscape(name)}">
    <Table ss:ExpandedColumnCount="${expandedCols}" ss:ExpandedRowCount="${expandedRows}">
      ${sheetColumnsXml(cols.map((c) => ({ width: c.width ?? 14 })))}
      ${rowXml(r1)}
      ${rowXml(r2)}
      ${dataRows.join("")}
    </Table>
    ${sheetOptionsXml(freezeRows, freezeCols)}
  </Worksheet>`;
  };

  // Rows: keep joined order
  const rows = participants.map((m: any, i: number) => ({
    idx: i + 1,
    user_id: String(m.user_id),
    name: String(m.display_name || ""),
    joined_at: m.joined_at,
  }));

  const alpha = [...rows].sort((a, b) => a.name.localeCompare(b.name, "ru"));

  // List sheet
  const buildListSheetXml = () => {
    const cols2 = [{ width: 5 }, { width: 40 }];
    const r1 = rowXml([cellXml("№", "sHeader", { type: "String" }), cellXml("ФИО", "sHeader", { type: "String" })]);
    const rr = alpha
      .map((r, i) => rowXml([cellXml(i + 1, "sCell", { type: "Number" }), cellXml(r.name, "sName", { type: "String" })]))
      .join("");

    const expandedCols = 2;
    const expandedRows = 1 + alpha.length;
    return `
  <Worksheet ss:Name="${xmlEscape("Список по алфавиту всех")}">
    <Table ss:ExpandedColumnCount="${expandedCols}" ss:ExpandedRowCount="${expandedRows}">
      ${sheetColumnsXml(cols2)}
      ${r1}
      ${rr}
    </Table>
    ${sheetOptionsXml(1, 0)}
  </Worksheet>`;
  };

  // Statistics sheet (1/0 completion + total)
  const buildStatSheetXml = () => {
    const statCols = [
      { key: "idx", header: "№", width: 5 },
      { key: "name", header: "ФИО", width: 30 },
      ...roomTests.map((rt: any) => ({
        key: String(rt.test_slug),
        header: String(testsJson[String(rt.test_slug)]?.title || rt.test_slug),
        width: 18,
      })),
      { key: "total", header: "итого", width: 10 },
    ];

    const headerRow = rowXml(statCols.map((c) => cellXml(c.header, "sHeader", { type: "String" })));

    const data = rows
      .map((r) => {
        let total = 0;
        const rowCells: string[] = [];
        rowCells.push(cellXml(r.idx, "sCell", { type: "Number" }));
        rowCells.push(cellXml(r.name, "sName", { type: "String" }));
        for (const rt of roomTests) {
          const slug = String(rt.test_slug);
          const has = !!resultByUserSlug.get(`${r.user_id}:${slug}`);
          const v = has ? 1 : 0;
          if (has) total++;
          rowCells.push(cellXml(v, "sCell", { type: "Number" }));
        }
        rowCells.push(cellXml(total, "sCell", { type: "Number" }));
        return rowXml(rowCells);
      })
      .join("");

    const expandedCols = statCols.length;
    const expandedRows = 1 + rows.length;

    return `
  <Worksheet ss:Name="${xmlEscape("статистика")}">
    <Table ss:ExpandedColumnCount="${expandedCols}" ss:ExpandedRowCount="${expandedRows}">
      ${sheetColumnsXml(statCols)}
      ${headerRow}
      ${data}
    </Table>
    ${sheetOptionsXml(1, 2)}
  </Worksheet>`;
  };

  const fileName = `${roomName}`.replace(/[\\/:*?"<>|]+/g, " ").trim() || "room";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="sHeader">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Font ss:Bold="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sHeaderSep">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Font ss:Bold="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sCell">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sCellSep">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sCellAlt">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Interior ss:Color="#F7F7F7" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sCellAltSep">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Interior ss:Color="#F7F7F7" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sName">
      <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sNameSep">
      <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sNameAlt">
      <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>
      <Interior ss:Color="#F7F7F7" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
    <Style ss:ID="sNameAltSep">
      <Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/>
      <Interior ss:Color="#F7F7F7" ss:Pattern="Solid"/>
      <Borders>
        <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/>
        <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="2"/>
        <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/>
      </Borders>
    </Style>
  </Styles>

  ${buildMurmanskSheetXml("СВОД", rows, 2, 2)}
  ${buildMurmanskSheetXml("СВОД по алфавиту", alpha, 2, 2)}
  ${buildListSheetXml()}
  ${buildStatSheetXml()}
</Workbook>`;

  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}-results.xls`);
  // Add BOM so Excel reliably detects UTF-8 for Cyrillic.
  return res.status(200).send(Buffer.from("\ufeff" + xml, "utf8"));

}
