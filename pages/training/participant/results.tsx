import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Layout } from '@/components/Layout';
import { DigitsTable } from '@/components/DigitsTable';
import type { ScoreResult } from '@/lib/score';

function fmt(ts: string) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

type AttemptRow = { attempt_id: string; test_slug: string; created_at: string; result: ScoreResult | null; client_text: string };

export default function ParticipantResultsPage() {
  const router = useRouter();
  const roomId = String(router.query.room_id || '');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [roomName, setRoomName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [overallPortrait, setOverallPortrait] = useState('');
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);

  const load = async () => {
    if (!roomId) return;
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/api/training/participant/results?room_id=${encodeURIComponent(roomId)}`);
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось загрузить результаты');
      setRoomName(String(j.room?.name || 'Мои результаты'));
      setDisplayName(String(j.member?.display_name || ''));
      setOverallPortrait(String(j.overall_portrait || ''));
      setAttempts(Array.isArray(j.attempts) ? j.attempts : []);
    } catch (e:any) { setErr(e?.message || 'Ошибка'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (roomId) load(); }, [roomId]);

  return (
    <Layout title={roomName || 'Мои результаты'}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/training" className="text-sm font-medium text-zinc-900 underline">← К тренингам</Link>
        <button onClick={load} disabled={loading} className="btn btn-secondary btn-sm">{loading ? '…' : 'Обновить'}</button>
      </div>
      {err ? <div className="mb-3 card text-sm text-red-600">{err}</div> : null}
      <div className="card">
        <div className="text-sm font-semibold text-zinc-900">Общий портрет</div>
        <div className="mt-1 text-xs text-zinc-500">{displayName ? `Участник: ${displayName}` : 'Ваш сводный профиль по результатам комнаты'}</div>
        <div className="mt-3 rounded-2xl border bg-white p-3 text-sm whitespace-pre-wrap">{overallPortrait || 'Пока нет данных.'}</div>
      </div>
      <div className="mt-4 grid gap-3">
        {attempts.map((a) => (
          <details key={a.attempt_id} className="card">
            <summary className="cursor-pointer list-none">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{a.test_slug}</div>
                  <div className="mt-1 text-xs text-zinc-500">{fmt(a.created_at)}</div>
                </div>
                <div className="text-xs text-zinc-500">Открыть</div>
              </div>
            </summary>
            {a.result ? <div className="mt-3"><DigitsTable result={a.result} /></div> : null}
            {a.client_text ? <div className="mt-3 rounded-2xl border bg-white p-3 text-sm whitespace-pre-wrap">{a.client_text}</div> : null}
          </details>
        ))}
        {!attempts.length && !loading ? <div className="card text-sm text-zinc-600">Пока нет завершённых тестов в этой комнате.</div> : null}
      </div>
    </Layout>
  );
}
