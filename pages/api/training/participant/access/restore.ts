import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { createTrainingRoomServerSession, setTrainingRoomSessionCookie } from '@/lib/trainingRoomServerSession';
import { getParticipantAccessByCode, getParticipantAccessByToken, touchParticipantAccess } from '@/lib/trainingRoomParticipantAccess';
import { setNoStore } from '@/lib/apiHardening';

function createSupabaseAdminFromEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Server env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const roomId = String(req.body?.room_id || '').trim();
  const token = String(req.body?.token || '').trim();
  const accessCode = String(req.body?.access_code || '').trim();
  if (!roomId) return res.status(400).json({ ok: false, error: 'room_id is required' });
  if (!token && !accessCode) return res.status(400).json({ ok: false, error: 'Нужна ссылка или код доступа' });

  let supabaseAdmin;
  try { supabaseAdmin = createSupabaseAdminFromEnv(); } catch (e:any) { return res.status(500).json({ ok: false, error: e?.message || 'env missing' }); }

  const lookup = token
    ? await getParticipantAccessByToken(supabaseAdmin as any, roomId, token)
    : await getParticipantAccessByCode(supabaseAdmin as any, roomId, accessCode);
  if (lookup.error) return res.status(500).json({ ok: false, error: lookup.error });
  if ('tableMissing' in lookup && lookup.tableMissing) return res.status(404).json({ ok: false, error: 'Механизм доступа ещё не включён' });
  if (!lookup.row) return res.status(404).json({ ok: false, error: 'Доступ не найден или устарел' });

  const roomSession = await createTrainingRoomServerSession(supabaseAdmin as any, {
    roomId,
    userId: lookup.row.user_id,
    displayName: lookup.row.display_name || '',
    role: 'participant',
  });
  if (!roomSession.ok && !('tableMissing' in roomSession && roomSession.tableMissing)) {
    return res.status(500).json({ ok: false, error: ('error' in roomSession ? roomSession.error : undefined) || 'Не удалось восстановить сессию' });
  }
  if (roomSession.ok) setTrainingRoomSessionCookie(res, roomId, roomSession.token, roomSession.expiresAt);
  await touchParticipantAccess(supabaseAdmin as any, roomId, lookup.row.user_id).catch(() => null);
  return res.status(200).json({ ok: true, room_id: roomId, display_name: lookup.row.display_name || '', redirect_to: `/training/participant/results?room_id=${encodeURIComponent(roomId)}` });
}
