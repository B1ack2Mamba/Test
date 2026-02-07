// Server-side "AI" interpretation helper.
//
// This project has a UI button "подробная расшифровка" that calls
// `POST /api/purchases/ai`. In some iterations the implementation module was
// missing which caused a build error:
//   Module not found: Can't resolve '@/lib/aiInterpretation'
//
// This file provides a deterministic, offline fallback implementation that
// doesn't require any external API keys. You can later swap the logic to call
// an LLM (OpenAI/DeepSeek/etc.) if you want richer text.

export type AiInterpretationInput = {
  test_slug: string;
  test_title?: string;
  result: any;
};

type ScoreRowLike = {
  tag?: string;
  style?: string;
  count?: number;
  percent?: number;
  level?: string;
};

function normLevel(level?: string): "низкий" | "средний" | "высокий" | "" {
  const l = String(level || "").toLowerCase();
  if (l.includes("низ")) return "низкий";
  if (l.includes("сред")) return "средний";
  if (l.includes("выс") || l.includes("силь")) return "высокий";
  return "";
}

function mdEsc(s: string) {
  return s.replaceAll("\r", "").trim();
}

function pickTop(rows: ScoreRowLike[], n: number) {
  const copy = [...rows];
  copy.sort((a, b) => Number(b.percent ?? 0) - Number(a.percent ?? 0));
  return copy.slice(0, n);
}

function pickBottom(rows: ScoreRowLike[], n: number) {
  const copy = [...rows];
  copy.sort((a, b) => Number(a.percent ?? 0) - Number(b.percent ?? 0));
  return copy.slice(0, n);
}

// --- 16PF: short meaning map (generic, works with your 0..10 scale)
const PF16_HINTS: Record<string, { low: string; mid: string; high: string }> = {
  A: {
    low: "держанность, дистанция, сдержанность в эмоциях",
    mid: "баланс теплоты и дистанции в общении",
    high: "открытость, дружелюбие, легкость установления контактов",
  },
  B: {
    low: "предпочтение простых решений, опора на практику",
    mid: "средний уровень абстрактного мышления",
    high: "быстрое схватывание, гибкое мышление, интерес к сложным задачам",
  },
  C: {
    low: "эмоциональная реактивность, чувствительность к стрессу",
    mid: "в целом устойчив, но может уставать от длительного напряжения",
    high: "эмоциональная стабильность, самообладание",
  },
  E: {
    low: "уступчивость, избегание конфронтаций",
    mid: "умеет и настаивать, и договариваться",
    high: "настойчивость, доминантность, склонность брать лидерство",
  },
  F: {
    low: "серьезность, сдержанность, осторожность",
    mid: "умеренная живость и динамичность",
    high: "энергичность, спонтанность, яркость эмоций",
  },
  G: {
    low: "гибкость к правилам, допускает отступления",
    mid: "обычно следует договоренностям, но без фанатизма",
    high: "ответственность, дисциплина, ориентация на нормы",
  },
  H: {
    low: "застенчивость, осторожность в новых контактах",
    mid: "средняя социальная смелость",
    high: "социальная уверенность, смелость в общении",
  },
  I: {
    low: "прагматичность, жесткость, опора на факты",
    mid: "баланс чувствительности и практичности",
    high: "чувствительность, эмпатия, тонкое восприятие",
  },
  L: {
    low: "доверчивость, прямота",
    mid: "здоровая осторожность и проверка",
    high: "настороженность, критичность, склонность проверять намерения",
  },
  M: {
    low: "практичность, реализм",
    mid: "и фантазия, и реализм в меру",
    high: "воображение, абстрактность, уход в идеи",
  },
  N: {
    low: "открытость, прямолинейность",
    mid: "умеет быть и открытым, и дипломатичным",
    high: "сдержанность, приватность, дипломатичность",
  },
  O: {
    low: "уверенность, спокойное отношение к ошибкам",
    mid: "умеренная самокритика",
    high: "самокритичность, тревожность, переживания",
  },
  Q1: {
    low: "консервативность, опора на привычные подходы",
    mid: "умеренная открытость новому",
    high: "открытость изменениям, интерес к новому",
  },
  Q2: {
    low: "ориентация на группу, поддержка команды",
    mid: "баланс автономности и командности",
    high: "самодостаточность, автономность, независимость",
  },
  Q3: {
    low: "гибкость, иногда спонтанность и 'небрежность'",
    mid: "умеренная организованность",
    high: "самоконтроль, организованность, перфекционизм",
  },
  Q4: {
    low: "расслабленность, низкое внутреннее напряжение",
    mid: "нормальный рабочий тонус",
    high: "напряженность, внутренняя 'взведенность', нетерпеливость",
  },
};

function render16PF(input: AiInterpretationInput) {
  const rows: ScoreRowLike[] = Array.isArray(input?.result?.ranked) ? input.result.ranked : [];
  const title = input.test_title || "16PF";
  const top = pickTop(rows, 3);
  const bottom = pickBottom(rows, 3);

  let out = `# Подробная расшифровка — ${mdEsc(title)}\n\n`;
  if (top.length) {
    out += `**Выражено сильнее всего:** ${top
      .map((r) => `${r.tag} (${r.count}/10)`) // count is 0..10 for 16PF
      .join(", ")}\n\n`;
  }
  if (bottom.length) {
    out += `**Выражено слабее всего:** ${bottom.map((r) => `${r.tag} (${r.count}/10)`).join(", ")}\n\n`;
  }

  out += `## По факторам\n`;
  for (const r of rows) {
    const code = String(r.tag || "");
    const name = String(r.style || code);
    const score = Number(r.count ?? 0);
    const lvl = normLevel(r.level);
    const hint = PF16_HINTS[code];
    let meaning = "";
    if (hint) {
      if (lvl === "низкий") meaning = hint.low;
      else if (lvl === "средний") meaning = hint.mid;
      else if (lvl === "высокий") meaning = hint.high;
      else meaning = hint.mid;
    }
    out += `\n**${code} — ${mdEsc(name)}:** ${score}/10 (${mdEsc(r.level || "")})`;
    if (meaning) out += `\n- ${mdEsc(meaning)}`;
    out += "\n";
  }

  out += `\n---\n`;
  out += `Это оффлайн-расшифровка (без внешнего ИИ). Если позже подключишь LLM, можно сделать текст глубже и персональнее.`;
  return out;
}

function renderGeneric(input: AiInterpretationInput) {
  const rows: ScoreRowLike[] = Array.isArray(input?.result?.ranked) ? input.result.ranked : [];
  const title = input.test_title || input.test_slug;
  const top = pickTop(rows, 5);

  let out = `# Подробная расшифровка — ${mdEsc(title)}\n\n`;
  if (top.length) {
    out += `## Ключевые акценты\n`;
    for (const r of top) {
      out += `- **${mdEsc(String(r.style || r.tag || ""))}**: ${Number(r.percent ?? 0)}% (${mdEsc(r.level || "")})\n`;
    }
    out += "\n";
  }
  out += `## Таблица\n`;
  for (const r of rows) {
    out += `- ${mdEsc(String(r.style || r.tag || ""))}: ${Number(r.percent ?? 0)}% (${mdEsc(r.level || "")})\n`;
  }
  out += `\n---\n`;
  out += `Это оффлайн-расшифровка (без внешнего ИИ).`;
  return out;
}

/**
 * Main entry.
 * Returns a markdown string.
 */
export async function aiInterpretation(input: AiInterpretationInput): Promise<string> {
  const kind = String(input?.result?.kind || "");
  if (kind === "16pf_v1") return render16PF(input);
  return renderGeneric(input);
}
