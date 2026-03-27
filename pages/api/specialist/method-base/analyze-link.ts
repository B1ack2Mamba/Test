import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/serverAuth';
import { isSpecialistUser } from '@/lib/specialist';
import { setNoStore } from '@/lib/apiHardening';
import { callDeepseekText } from '@/lib/deepseek';

function text(v: any) {
  return String(v || '').trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: 'Forbidden' });

  const itemsRaw = Array.isArray(req.body?.items) ? req.body.items : [];
  const items = itemsRaw
    .map((raw: any) => ({
      testTitle: text(raw?.test_title || raw?.testTitle || raw?.testSlug),
      resultLabel: text(raw?.result_label || raw?.resultLabel),
      answerValue: text(raw?.answer_value || raw?.answerValue),
      answerNote: text(raw?.answer_note || raw?.answerNote),
    }))
    .filter((item: any) => item.testTitle && item.resultLabel);

  const task = text(req.body?.task);
  if (items.length < 2) return res.status(400).json({ ok: false, error: 'Нужно минимум 2 результата для анализа связи' });

  try {
    const textOut = await callDeepseekText({
      system: [
        'Ты помогаешь специалисту по оценке персонала формулировать методические выводы по сочетанию результатов разных тестов.',
        'Не ставь диагнозов, не выдумывай фактов и не делай медицинских выводов.',
        'Пиши по-русски, профессионально и ясно.',
        'Если результат задан диапазоном чисел, трактуй его как рабочий диапазон выраженности, а не как одну фиксированную точку.',
        'Верни 4 коротких блока с подзаголовками: Общий смысл, Что это может давать в поведении, Риски интерпретации, Что стоит уточнить специалисту.',
      ].join(' '),
      user: [
        'Проанализируй сочетание результатов разных тестов как методическую гипотезу.',
        '',
        ...items.map((item: any, index: number) => [
          `Результат ${index + 1}:`,
          `Тест: ${item.testTitle}`,
          `Показатель: ${item.resultLabel}`,
          `Ответ / уровень: ${item.answerValue || 'не указан'}`,
          `Комментарий: ${item.answerNote || '—'}`,
          '',
        ].join('\n')),
        task ? `Дополнительная задача специалиста: ${task}` : '',
      ].filter(Boolean).join('\n'),
      temperature: 0.2,
      maxTokensChat: 2600,
      maxTokensReasoner: 5000,
      timeoutMs: 90000,
    });

    return res.status(200).json({ ok: true, text: textOut });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'AI analysis failed' });
  }
}
