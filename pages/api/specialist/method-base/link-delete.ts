import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/serverAuth';
import { isSpecialistUser } from '@/lib/specialist';
import { setNoStore, retryTransientApi } from '@/lib/apiHardening';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: 'Forbidden' });

  const id = String(req.body?.id || '').trim();
  if (!id) return res.status(400).json({ ok: false, error: 'id обязателен' });

  try {
    const { error } = await retryTransientApi<any>(
      () => auth.supabaseAdmin.from('specialist_method_links').delete().eq('id', id).eq('specialist_user_id', auth.user.id),
      { attempts: 2, delayMs: 150 }
    );
    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to delete link' });
  }
}
