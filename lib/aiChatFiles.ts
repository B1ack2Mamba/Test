import mammoth from "mammoth";
import * as XLSX from "xlsx";
import zlib from "zlib";

export type ChatMessageForPrompt = {
  role: "user" | "assistant";
  content: string;
};

export type UploadedFile = {
  id?: string;
  name: string;
  type?: string;
  size?: number;
  data: string;
};

export type FileAttachment = {
  id?: string;
  name: string;
  size: number;
  textChars: number;
  truncated: boolean;
};

export type ExtractedFileText = FileAttachment & {
  text: string;
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_TEXT_CHARS = 60_000;
const MAX_TOTAL_FILE_TEXT_CHARS = 90_000;
const MAX_PLATFORM_CONTEXT_CHARS = 80_000;

function decodeBase64Payload(data: string) {
  const raw = String(data || "");
  const comma = raw.indexOf(",");
  const b64 = raw.startsWith("data:") && comma >= 0 ? raw.slice(comma + 1) : raw;
  return Buffer.from(b64, "base64");
}

function trimForPrompt(text: string, maxChars: number) {
  const clean = String(text || "").replace(/\u0000/g, "").trim();
  if (clean.length <= maxChars) return { text: clean, truncated: false };
  return {
    text: `${clean.slice(0, maxChars).trimEnd()}\n\n[Файл обрезан: показаны первые ${maxChars} символов.]`,
    truncated: true,
  };
}

function cleanExtractedText(text: string) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, "")
    .trim();
}

function decodePdfLiteral(input: string) {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = input[++i];
    if (!next) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "\n" || next === "\r") {
      if (next === "\r" && input[i + 1] === "\n") i++;
    } else if (/[0-7]/.test(next)) {
      let oct = next;
      for (let j = 0; j < 2 && /[0-7]/.test(input[i + 1] || ""); j++) oct += input[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else {
      out += next;
    }
  }
  return decodePdfStringBytes(Buffer.from(out, "latin1"));
}

function decodePdfStringBytes(bytes: Buffer) {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    return out;
  }
  const utf8 = bytes.toString("utf8");
  return utf8.includes("�") ? bytes.toString("latin1") : utf8;
}

function decodePdfHex(input: string) {
  const hex = input.replace(/[^0-9a-f]/gi, "");
  if (!hex) return "";
  const padded = hex.length % 2 ? `${hex}0` : hex;
  return decodePdfStringBytes(Buffer.from(padded, "hex"));
}

function extractPdfStringsFromContent(content: string) {
  const parts: string[] = [];
  const textObjects = content.match(/BT[\s\S]*?ET/g) || [content];

  for (const block of textObjects) {
    const arrayRe = /\[((?:\\.|[^\]])*)\]\s*TJ/g;
    let arrayMatch: RegExpExecArray | null;
    while ((arrayMatch = arrayRe.exec(block))) {
      const arrayBody = arrayMatch[1] || "";
      const strings = [...arrayBody.matchAll(/\((?:\\.|[^\\()])*\)|<[\da-fA-F\s]+>/g)]
        .map((m) => {
          const token = m[0];
          return token.startsWith("(") ? decodePdfLiteral(token.slice(1, -1)) : decodePdfHex(token.slice(1, -1));
        })
        .filter(Boolean);
      if (strings.length) parts.push(strings.join(""));
    }

    const stringRe = /(\((?:\\.|[^\\()])*\)|<[\da-fA-F\s]+>)\s*(?:Tj|'|")/g;
    let stringMatch: RegExpExecArray | null;
    while ((stringMatch = stringRe.exec(block))) {
      const token = stringMatch[1] || "";
      const text = token.startsWith("(") ? decodePdfLiteral(token.slice(1, -1)) : decodePdfHex(token.slice(1, -1));
      if (text) parts.push(text);
    }
  }

  return cleanExtractedText(parts.join("\n"));
}

function inflateMaybe(data: Buffer) {
  try {
    return zlib.inflateSync(data);
  } catch {
    try {
      return zlib.inflateRawSync(data);
    } catch {
      return data;
    }
  }
}

function extractPdfText(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  const chunks: string[] = [];
  const streamRe = /([\s\S]{0,600})stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRe.exec(raw))) {
    const header = match[1] || "";
    const stream = Buffer.from(match[2] || "", "latin1");
    const data = /\/FlateDecode/i.test(header) ? inflateMaybe(stream) : stream;
    const text = extractPdfStringsFromContent(data.toString("latin1"));
    if (text) chunks.push(text);
  }

  const direct = extractPdfStringsFromContent(raw);
  if (direct) chunks.push(direct);

  const text = cleanExtractedText([...new Set(chunks)].join("\n\n"));
  if (!text) {
    throw new Error("PDF не удалось разобрать: файл может быть сканом или защищённым документом");
  }
  return text;
}

export async function extractFileText(file: UploadedFile): Promise<ExtractedFileText> {
  const id = file?.id ? String(file.id) : undefined;
  const name = String(file?.name || "file").trim();
  const lower = name.toLowerCase();
  const buffer = decodeBase64Payload(file?.data || "");
  if (!buffer.length) throw new Error(`Файл ${name}: пустой файл`);
  if (buffer.byteLength > MAX_FILE_BYTES) throw new Error(`Файл ${name}: максимум 10 МБ`);

  let text = "";
  if (lower.endsWith(".docx")) {
    const out = await mammoth.extractRawText({ buffer });
    text = out.value || "";
  } else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames.slice(0, 12)) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (csv.trim()) parts.push(`Лист: ${sheetName}\n${csv}`);
    }
    text = parts.join("\n\n");
  } else if (lower.endsWith(".pdf")) {
    text = extractPdfText(buffer);
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".md")) {
    text = buffer.toString("utf8");
  } else {
    throw new Error(`Файл ${name}: поддерживаются .docx, .xlsx, .xls, .csv, .txt, .md, .pdf`);
  }

  const trimmed = trimForPrompt(text, MAX_FILE_TEXT_CHARS);
  return {
    id,
    name,
    size: buffer.byteLength,
    text: trimmed.text,
    textChars: trimmed.text.length,
    truncated: trimmed.truncated,
  };
}

function appendToLastUserMessage(messages: ChatMessageForPrompt[], addition: string) {
  const next: ChatMessageForPrompt[] = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === "user") {
      next[i] = { ...next[i], content: `${next[i].content}\n\n${addition}` };
      return next;
    }
  }
  return [...next, { role: "user" as const, content: addition }];
}

export async function appendAttachmentsToLastUserMessage(
  messages: ChatMessageForPrompt[],
  filesInput: any,
  platformContextInput?: string
): Promise<{ messages: ChatMessageForPrompt[]; files: FileAttachment[]; platformContextChars: number; platformContextTruncated: boolean }> {
  let next = [...messages];
  const platformTrimmed = trimForPrompt(String(platformContextInput || ""), MAX_PLATFORM_CONTEXT_CHARS);
  if (platformTrimmed.text) {
    next = appendToLastUserMessage(next, `Контекст из платформы:\n\n${platformTrimmed.text}`);
  }

  const files = Array.isArray(filesInput) ? filesInput.slice(0, 4) : [];
  if (!files.length) {
    return {
      messages: next,
      files: [],
      platformContextChars: platformTrimmed.text.length,
      platformContextTruncated: platformTrimmed.truncated,
    };
  }

  const extracted = await Promise.all(files.map((f) => extractFileText(f)));
  let used = 0;
  const blocks: string[] = [];
  const attachments: FileAttachment[] = [];
  for (const file of extracted) {
    const remaining = MAX_TOTAL_FILE_TEXT_CHARS - used;
    if (remaining <= 0) break;
    const trimmed = trimForPrompt(file.text, remaining);
    used += trimmed.text.length;
    attachments.push({
      id: file.id,
      name: file.name,
      size: file.size,
      textChars: trimmed.text.length,
      truncated: file.truncated || trimmed.truncated,
    });
    blocks.push(`Файл: ${file.name}\nРазмер: ${file.size} байт\nСодержимое:\n${trimmed.text}`);
  }

  if (blocks.length) {
    next = appendToLastUserMessage(next, `Приложенные файлы для анализа:\n\n${blocks.join("\n\n---\n\n")}`);
  }

  return {
    messages: next,
    files: attachments,
    platformContextChars: platformTrimmed.text.length,
    platformContextTruncated: platformTrimmed.truncated,
  };
}

export function previewFromText(text: string, maxChars = 1400) {
  const clean = cleanExtractedText(text);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars).trimEnd()}...`;
}
