import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/serverAuth';
import { isSpecialistUser } from '@/lib/specialist';
import { setNoStore } from '@/lib/apiHardening';
import { getMethodBaseCatalog } from '@/lib/methodBaseCatalog';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: 'Forbidden' });

  try {
    const tests = await getMethodBaseCatalog();
    return res.status(200).json({ ok: true, tests });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to load catalog' });
  }
}
