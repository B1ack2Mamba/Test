import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Layout } from '@/components/Layout';

export default function TrainingAccessPage() {
  const router = useRouter();
  const roomId = String(router.query.room_id || '');
  const token = String(router.query.token || '');
  const [accessCode, setAccessCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const restore = async (payload: any) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/training/participant/access/restore', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось восстановить доступ');
      router.replace(j.redirect_to || `/training/participant/results?room_id=${encodeURIComponent(payload.room_id)}`);
    } catch (e:any) {
      setErr(e?.message || 'Ошибка');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    if (!router.isReady || !roomId || !token) return;
    restore({ room_id: roomId, token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, roomId, token]);

  return (
    <Layout title="Доступ к результатам">
      <div className="card max-w-2xl text-sm text-zinc-700">
        <div className="text-lg font-semibold text-zinc-900">Доступ к вашим результатам</div>
        <div className="mt-2 text-zinc-600">Вы можете открыть результаты по персональной ссылке или ввести код доступа, который получили после входа в комнату.</div>
        <div className="mt-4 grid gap-2">
          <div className="text-xs font-medium text-zinc-700">Код доступа</div>
          <input className="input" value={accessCode} onChange={(e)=> setAccessCode(e.target.value.toUpperCase())} placeholder="Например: ABCD-EFGH" />
        </div>
        {err ? <div className="mt-3 text-sm text-red-600">{err}</div> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy || !roomId || !accessCode.trim()} onClick={()=> restore({ room_id: roomId, access_code: accessCode.trim() })}>{busy ? 'Открываем…' : 'Открыть мои результаты'}</button>
        </div>
      </div>
    </Layout>
  );
}
