import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTrainingRoomAccess } from '@/lib/trainingRoomServerSession';
import { setNoStore } from '@/lib/apiHardening';

function titleBySlug(slug: string) {
  const s = String(slug || '');
  return s;
}

function buildOverallPortrait(attempts: any[]) {
  if (!attempts.length) return 'Пока нет завершённых тестов. Когда вы пройдёте тесты комнаты, здесь появится общий портрет по результатам.';
  const lines: string[] = [];
  lines.push(`Пройдено тестов: ${attempts.length}.`);
  const latest = [...attempts].sort((a,b)=> String(b.created_at).localeCompare(String(a.created_at))).slice(0,3);
  lines.push(`Последние результаты: ${latest.map((a:any)=> titleBySlug(a.test_slug)).join(', ')}.`);
  const sharedTexts = attempts.map((a:any)=> String(a.client_text || '').trim()).filter(Boolean);
  if (sharedTexts.length) {
    lines.push('Общий портрет по доступным интерпретациям:');
    for (const t of sharedTexts.slice(0,3)) lines.push(t);
  } else {
    lines.push('Подробные расшифровки пока не подготовлены. Ниже доступны результаты по отдельным тестам.');
  }
  return lines.join('\n\n');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const roomId = String(req.query.room_id || '').trim();
  if (!roomId) return res.status(400).json({ ok: false, error: 'room_id is required' });
  const access = await requireTrainingRoomAccess(req, res, roomId);
  if (!access) return;
  const { user, supabaseAdmin, member } = access;

  const { data: room } = await (supabaseAdmin as any).from('training_rooms').select('id,name,participants_can_see_digits').eq('id', roomId).maybeSingle();
  const { data: attempts, error } = await (supabaseAdmin as any)
    .from('training_attempts')
    .select('id,test_slug,room_id,created_at,result')
    .eq('room_id', roomId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ ok: false, error: error.message || 'Не удалось загрузить результаты' });

  const ids = (attempts || []).map((a:any)=> String(a.id));
  const clientTexts = new Map<string,string>();
  if (ids.length) {
    const { data: interps } = await (supabaseAdmin as any)
      .from('training_attempt_interpretations')
      .select('attempt_id,kind,text')
      .in('attempt_id', ids)
      .eq('kind', 'client_text');
    for (const row of interps || []) clientTexts.set(String((row as any).attempt_id), String((row as any).text || ''));
  }

  const out = (attempts || []).map((a:any)=> ({
    attempt_id: String(a.id),
    test_slug: String(a.test_slug),
    created_at: String(a.created_at),
    result: a.result || null,
    client_text: clientTexts.get(String(a.id)) || '',
  }));
  return res.status(200).json({
    ok: true,
    room: room ? { id: room.id, name: room.name, participants_can_see_digits: Boolean(room.participants_can_see_digits) } : null,
    member: { display_name: member?.display_name || '' },
    overall_portrait: buildOverallPortrait(out),
    attempts: out,
  });
}
