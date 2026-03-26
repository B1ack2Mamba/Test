import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/serverAuth';
import { isSpecialistUser } from '@/lib/specialist';
import { setNoStore, retryTransientApi } from '@/lib/apiHardening';

function isMissingTableError(err: any) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return code === '42P01' || /does not exist|relation .* does not exist/i.test(msg);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: 'Forbidden' });

  try {
    const { data: links, error: linksErr } = await retryTransientApi<any>(
      () => auth.supabaseAdmin
        .from('specialist_method_links')
        .select('id,title,ai_task,ai_draft,final_text,is_active,created_at,updated_at')
        .eq('specialist_user_id', auth.user.id)
        .order('updated_at', { ascending: false }),
      { attempts: 2, delayMs: 150 }
    );
    if (linksErr) {
      if (isMissingTableError(linksErr)) return res.status(200).json({ ok: true, links: [], missing_migration: true });
      return res.status(500).json({ ok: false, error: linksErr.message });
    }
    const linkIds = (links || []).map((x: any) => String(x.id)).filter(Boolean);
    let items: any[] = [];
    if (linkIds.length) {
      const itemsResp = await retryTransientApi<any>(
        () => auth.supabaseAdmin
          .from('specialist_method_link_items')
          .select('id,link_id,sort_order,test_slug,test_title,result_key,result_label,answer_value,answer_note')
          .in('link_id', linkIds)
          .order('sort_order', { ascending: true }),
        { attempts: 2, delayMs: 150 }
      );
      if (itemsResp.error) {
        if (isMissingTableError(itemsResp.error)) return res.status(200).json({ ok: true, links: [], missing_migration: true });
        return res.status(500).json({ ok: false, error: itemsResp.error.message });
      }
      items = itemsResp.data || [];
    }
    const itemsByLink = new Map<string, any[]>();
    for (const item of items) {
      const key = String(item.link_id);
      const list = itemsByLink.get(key) || [];
      list.push(item);
      itemsByLink.set(key, list);
    }
    const out = (links || []).map((link: any) => ({ ...link, items: itemsByLink.get(String(link.id)) || [] }));
    return res.status(200).json({ ok: true, links: out });
  } catch (e: any) {
    if (isMissingTableError(e)) return res.status(200).json({ ok: true, links: [], missing_migration: true });
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to load links' });
  }
}
