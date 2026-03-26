import type { NextApiRequest, NextApiResponse } from 'next';
import { requireUser } from '@/lib/serverAuth';
import { isSpecialistUser } from '@/lib/specialist';
import { setNoStore, retryTransientApi } from '@/lib/apiHardening';

function normalizeText(v: any) {
  return String(v || '').trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  setNoStore(res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const auth = await requireUser(req, res, { requireEmail: true });
  if (!auth) return;
  if (!isSpecialistUser(auth.user)) return res.status(403).json({ ok: false, error: 'Forbidden' });

  const body = req.body || {};
  const id = normalizeText(body.id);
  const title = normalizeText(body.title);
  const aiTask = normalizeText(body.aiTask);
  const aiDraft = normalizeText(body.aiDraft);
  const finalText = normalizeText(body.finalText);
  const isActive = body.isActive !== false;
  const items = Array.isArray(body.items) ? body.items : [];

  const cleanedItems = items
    .map((raw: any, index: number) => ({
      sort_order: index,
      test_slug: normalizeText(raw?.test_slug || raw?.testSlug),
      test_title: normalizeText(raw?.test_title || raw?.testTitle),
      result_key: normalizeText(raw?.result_key || raw?.resultKey),
      result_label: normalizeText(raw?.result_label || raw?.resultLabel),
      answer_value: normalizeText(raw?.answer_value || raw?.answerValue),
      answer_note: normalizeText(raw?.answer_note || raw?.answerNote),
    }))
    .filter((item: any) => item.test_slug && item.result_key && item.result_label);

  const uniqueTests = Array.from(new Set(cleanedItems.map((x: any) => x.test_slug)));
  if (cleanedItems.length < 2 || uniqueTests.length < 2) {
    return res.status(400).json({ ok: false, error: 'Нужно выбрать минимум 2 результата из разных тестов' });
  }

  try {
    let linkId = id;
    const payload = {
      specialist_user_id: auth.user.id,
      title: title || cleanedItems.map((x: any) => `${x.test_title || x.test_slug}: ${x.result_label}`).slice(0, 3).join(' • '),
      ai_task: aiTask,
      ai_draft: aiDraft,
      final_text: finalText,
      is_active: isActive,
      item_count: cleanedItems.length,
      updated_at: new Date().toISOString(),
    } as any;

    if (linkId) {
      const { error: upErr } = await retryTransientApi<any>(
        () => auth.supabaseAdmin
          .from('specialist_method_links')
          .update(payload)
          .eq('id', linkId)
          .eq('specialist_user_id', auth.user.id),
        { attempts: 2, delayMs: 150 }
      );
      if (upErr) return res.status(500).json({ ok: false, error: upErr.message });
    } else {
      const { data: ins, error: insErr } = await retryTransientApi<any>(
        () => auth.supabaseAdmin
          .from('specialist_method_links')
          .insert(payload)
          .select('id')
          .single(),
        { attempts: 2, delayMs: 150 }
      );
      if (insErr) return res.status(500).json({ ok: false, error: insErr.message });
      linkId = String(ins?.id || '');
      if (!linkId) return res.status(500).json({ ok: false, error: 'Не удалось получить id связи' });
    }

    const { error: delErr } = await retryTransientApi<any>(
      () => auth.supabaseAdmin.from('specialist_method_link_items').delete().eq('link_id', linkId),
      { attempts: 2, delayMs: 150 }
    );
    if (delErr) return res.status(500).json({ ok: false, error: delErr.message });

    const insertItems = cleanedItems.map((item: any) => ({ ...item, link_id: linkId, specialist_user_id: auth.user.id }));
    const { error: itemsErr } = await retryTransientApi<any>(
      () => auth.supabaseAdmin.from('specialist_method_link_items').insert(insertItems),
      { attempts: 2, delayMs: 150 }
    );
    if (itemsErr) return res.status(500).json({ ok: false, error: itemsErr.message });

    return res.status(200).json({ ok: true, id: linkId });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || 'Failed to save link' });
  }
}
