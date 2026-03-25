import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/serverAuth';
import { isSpecialistUser } from '@/lib/specialist';
import { setNoStore } from '@/lib/apiHardening';
import { callDeepseekText } from '@/lib/deepseek';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: 'Forbidden' });

  const body = req.body || {};
  const fromNode = body.fromNode || null;
  const toNode = body.toNode || null;
  const relationType = String(body.relationType || '').trim();
  const task = String(body.task || '').trim();
  const context = String(body.context || '').trim();
  if (!fromNode || !toNode) return res.status(400).json({ ok: false, error: 'fromNode и toNode обязательны' });

  try {
    const text = await callDeepseekText({
      system:
        'Ты помогаешь специалисту по оценке персонала формулировать рабочие гипотезы по сочетанию результатов тестов. Не ставь диагнозов, не выдумывай факты, пиши как методист. Ответ должен быть на русском языке. Верни 4 коротких блока с подзаголовками: Смысл связи, Что это может значить, Риски интерпретации, Что проверить дальше.',
      user: [
        'Проанализируй связь между двумя результатами тестов.',
        `Связь: ${relationType || 'смысловая связь'}`,
        '',
        'Результат 1:',
        `Тест: ${String(fromNode.testTitle || fromNode.testSlug || '—')}`,
        `Короткое название: ${String(fromNode.label || '—')}`,
        `Числа/уровень: ${String(fromNode.value || '—')}`,
        `Описание: ${String(fromNode.note || '—')}`,
        '',
        'Результат 2:',
        `Тест: ${String(toNode.testTitle || toNode.testSlug || '—')}`,
        `Короткое название: ${String(toNode.label || '—')}`,
        `Числа/уровень: ${String(toNode.value || '—')}`,
        `Описание: ${String(toNode.note || '—')}`,
        '',
        context ? `Методическая рамка специалиста: ${context}` : '',
        task ? `Дополнительная задача специалиста: ${task}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      temperature: 0.2,
      maxTokensChat: 2200,
      maxTokensReasoner: 4000,
      timeoutMs: 90000,
    });

    return res.status(200).json({ ok: true, text });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'AI analysis failed' });
  }
}
