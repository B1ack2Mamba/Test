import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTrainingRoomAccess } from '@/lib/trainingRoomServerSession';
import { ensureParticipantAccess, touchParticipantAccess } from '@/lib/trainingRoomParticipantAccess';
import { setNoStore } from '@/lib/apiHardening';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const roomId = String(req.query.room_id || '').trim();
  if (!roomId) return res.status(400).json({ ok: false, error: 'room_id is required' });

  const access = await requireTrainingRoomAccess(req, res, roomId);
  if (!access) return;
  const { user, supabaseAdmin, member } = access;

  const state = await ensureParticipantAccess(supabaseAdmin as any, { roomId, userId: user.id, displayName: member?.display_name || '' });
  if (!state.ok) {
    if ('tableMissing' in state && state.tableMissing) return res.status(200).json({ ok: true, enabled: false });
    return res.status(500).json({ ok: false, error: ('error' in state ? state.error : undefined) || 'Не удалось подготовить доступ участника' });
  }
  await touchParticipantAccess(supabaseAdmin as any, roomId, user.id).catch(() => null);
  const proto = String(req.headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http'));
  const host = String(req.headers.host || 'localhost:3000');
  const access_url = `${proto}://${host}/training/access?room_id=${encodeURIComponent(roomId)}&token=${encodeURIComponent(state.accessToken)}`;
  return res.status(200).json({ ok: true, enabled: true, access_code: state.row.access_code, access_url });
}
