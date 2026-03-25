import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Layout } from '@/components/Layout';
import { useSession } from '@/lib/useSession';
import { isSpecialistUser } from '@/lib/specialist';

type Room = { id: string; name: string; created_at: string; is_active: boolean };
type DashboardPayload = { room?: { id: string; name: string; analysis_prompt?: string; group_analysis_prompt?: string } };

type TestOption = { slug: string; title: string };

type ResultNode = {
  id: string;
  testSlug: string;
  label: string;
  value: string;
  note: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type ResultLink = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationType: string;
  task: string;
  aiDraft: string;
  finalText: string;
  includeInPrompt: boolean;
  createdAt: string;
  updatedAt: string;
};

type PromptTemplate = {
  id: string;
  title: string;
  type: 'individual' | 'group';
  content: string;
  active: boolean;
};

type Store = {
  nodes: ResultNode[];
  links: ResultLink[];
  templates: PromptTemplate[];
};

const TEST_OPTIONS: TestOption[] = [
  { slug: '16pf-a', title: '16PF-A' },
  { slug: 'belbin', title: 'Опросник Белбина' },
  { slug: 'color-types', title: 'Цветотипы' },
  { slug: 'emin', title: 'ЭМИН (эмоциональный интеллект)' },
  { slug: 'learning-typology', title: 'Типология обучения' },
  { slug: 'motivation-cards', title: 'Мотивационные карты' },
  { slug: 'situational-guidance', title: 'Ситуативное руководство' },
  { slug: 'time-management', title: 'Тайм-менеджмент' },
  { slug: 'usk', title: 'УСК' },
];

const RELATION_OPTIONS = [
  'усиливает',
  'ослабляет',
  'в противоречии',
  'компенсирует',
  'даёт риск',
  'даёт ресурс',
  'нужно перепроверить',
];

const STORAGE_KEY_BASE = 'specialist-method-workspace-v2';

function storageKeyForUser(userId?: string) {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_BASE;
}
function nowIso() { return new Date().toISOString(); }
function uid(prefix: string) { return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`; }
function normalizeText(value: string) { return String(value || '').replace(/\r\n/g, '\n').trim(); }
function titleBySlug(slug: string) { return TEST_OPTIONS.find((t) => t.slug === slug)?.title || slug || 'Тест'; }

const defaultStore: Store = {
  nodes: [
    {
      id: uid('node'),
      testSlug: 'situational-guidance',
      label: 'Полярное распределение стилей',
      value: 'S1 и S4 выше, S2 и S3 ниже',
      note: 'Фиксируй контраст между контролем и делегированием, без устойчивых промежуточных режимов.',
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: uid('node'),
      testSlug: 'emin',
      label: 'Сниженная саморегуляция',
      value: 'Ниже среднего',
      note: 'Смотри риск эмоциональной реактивности и истощения в напряжённых коммуникациях.',
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ],
  links: [],
  templates: [
    {
      id: uid('tpl'),
      title: 'Индивидуальный портрет',
      type: 'individual',
      content: 'Используй связи между результатами тестов как рабочие гипотезы. Не подменяй факты догадками. Отдельно выделяй риски, ресурсы, внутренние противоречия и мягкий текст для клиента.',
      active: true,
    },
    {
      id: uid('tpl'),
      title: 'Групповой анализ',
      type: 'group',
      content: 'Ищи повторяющиеся сочетания, различия между участниками, групповые риски и управленческие рекомендации. Не повторяй один и тот же смысл разными словами.',
      active: true,
    },
  ],
};

defaultStore.links.push({
  id: uid('link'),
  fromNodeId: defaultStore.nodes[0].id,
  toNodeId: defaultStore.nodes[1].id,
  relationType: 'даёт риск',
  task: 'Опиши смысл этой связи как методист для специалиста.',
  aiDraft: '',
  finalText: 'Если полярные стили руководства сочетаются со слабой саморегуляцией, у человека может появляться качель между жёстким давлением и резким снятием контроля под нагрузкой.',
  includeInPrompt: true,
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

function safeParseStore(raw: string | null): Store {
  if (!raw) return defaultStore;
  try {
    const parsed = JSON.parse(raw);
    return {
      nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : defaultStore.nodes,
      links: Array.isArray(parsed?.links) ? parsed.links : defaultStore.links,
      templates: Array.isArray(parsed?.templates) ? parsed.templates : defaultStore.templates,
    };
  } catch {
    return defaultStore;
  }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const inputClass = 'w-full rounded-2xl border bg-white px-4 py-3 text-sm leading-6';
const areaClass = 'w-full min-h-[110px] resize-y rounded-2xl border bg-white px-4 py-3 text-sm leading-6';

function ButtonTab({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold ${active ? 'bg-indigo-100 text-indigo-950' : 'bg-white hover:bg-zinc-50'}`} onClick={onClick}>{children}</button>;
}

export default function SpecialistMethodBasePage() {
  const { session, user } = useSession();
  const router = useRouter();
  const roomIdFromQuery = typeof router.query.room_id === 'string' ? router.query.room_id : '';

  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [roomErr, setRoomErr] = useState('');
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomLoading, setRoomLoading] = useState(false);
  const [store, setStore] = useState<Store>(defaultStore);
  const [hydrated, setHydrated] = useState(false);
  const [activeMode, setActiveMode] = useState<'map' | 'prompts'>('map');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [selectedLinkId, setSelectedLinkId] = useState('');
  const [newLinkFrom, setNewLinkFrom] = useState('');
  const [newLinkTo, setNewLinkTo] = useState('');
  const [newLinkType, setNewLinkType] = useState(RELATION_OPTIONS[0]);
  const [globalMethodNote, setGlobalMethodNote] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [copiedMsg, setCopiedMsg] = useState('');
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (roomIdFromQuery) setSelectedRoomId(roomIdFromQuery); }, [roomIdFromQuery]);

  useEffect(() => {
    if (typeof window === 'undefined' || !user?.id) return;
    const parsed = safeParseStore(window.localStorage.getItem(storageKeyForUser(user.id)));
    setStore(parsed);
    setSelectedNodeId(parsed.nodes[0]?.id || '');
    setSelectedLinkId(parsed.links[0]?.id || '');
    setNewLinkFrom(parsed.nodes[0]?.id || '');
    setNewLinkTo(parsed.nodes[1]?.id || parsed.nodes[0]?.id || '');
    setHydrated(true);
  }, [user?.id]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined' || !user?.id) return;
    window.localStorage.setItem(storageKeyForUser(user.id), JSON.stringify(store));
  }, [hydrated, store, user?.id]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      setRoomsLoading(true);
      try {
        const r = await fetch('/api/training/rooms/my', { headers: { authorization: `Bearer ${session.access_token}` }, cache: 'no-store' });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось загрузить комнаты');
        if (cancelled) return;
        const nextRooms = Array.isArray(j.rooms) ? j.rooms as Room[] : [];
        setRooms(nextRooms);
        if (!selectedRoomId && nextRooms[0]?.id) setSelectedRoomId(nextRooms[0].id);
      } catch (e: any) {
        if (!cancelled) setRoomErr(e?.message || 'Ошибка');
      } finally {
        if (!cancelled) setRoomsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.access_token]);

  useEffect(() => {
    if (!session || !selectedRoomId) { setDashboard(null); return; }
    let cancelled = false;
    (async () => {
      setRoomLoading(true);
      setRoomErr('');
      try {
        const r = await fetch(`/api/training/rooms/dashboard?room_id=${encodeURIComponent(selectedRoomId)}`, { headers: { authorization: `Bearer ${session.access_token}` }, cache: 'no-store' });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось загрузить комнату');
        if (!cancelled) setDashboard(j);
      } catch (e: any) {
        if (!cancelled) setRoomErr(e?.message || 'Ошибка');
      } finally {
        if (!cancelled) setRoomLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.access_token, selectedRoomId]);

  const nodes = useMemo(() => [...store.nodes].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [store.nodes]);
  const links = useMemo(() => [...store.links].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [store.links]);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;
  const selectedLink = links.find((l) => l.id === selectedLinkId) || null;
  const individualTemplate = store.templates.find((t) => t.type === 'individual' && t.active) || store.templates.find((t) => t.type === 'individual') || null;
  const groupTemplate = store.templates.find((t) => t.type === 'group' && t.active) || store.templates.find((t) => t.type === 'group') || null;

  const linkView = useMemo(() => {
    return links.map((link) => {
      const from = nodes.find((n) => n.id === link.fromNodeId) || null;
      const to = nodes.find((n) => n.id === link.toNodeId) || null;
      return { link, from, to };
    }).filter((row) => row.from && row.to);
  }, [links, nodes]);

  const promptBody = useMemo(() => {
    const resultSection = nodes
      .filter((n) => n.active)
      .map((node, index) => `${index + 1}. ${titleBySlug(node.testSlug)}
Короткое имя результата: ${node.label || '—'}
Значение/уровень: ${node.value || '—'}
Описание: ${node.note || '—'}`)
      .join('\n\n');

    const relationSection = linkView
      .filter((row) => row.link.includeInPrompt)
      .map((row, index) => `${index + 1}. ${row.from?.label || '—'} ↔ ${row.to?.label || '—'}
Тесты: ${titleBySlug(row.from?.testSlug || '')} ↔ ${titleBySlug(row.to?.testSlug || '')}
Тип связи: ${row.link.relationType || '—'}
Вывод специалиста: ${normalizeText(row.link.finalText || row.link.aiDraft) || '—'}`)
      .join('\n\n');

    return {
      individual: [
        individualTemplate?.content || '',
        globalMethodNote ? `Дополнительная рамка специалиста:\n${normalizeText(globalMethodNote)}` : '',
        resultSection ? `Результаты тестов:\n${resultSection}` : '',
        relationSection ? `Связи между результатами:\n${relationSection}` : '',
      ].filter(Boolean).join('\n\n'),
      group: [
        groupTemplate?.content || '',
        globalMethodNote ? `Методическая рамка специалиста:\n${normalizeText(globalMethodNote)}` : '',
        relationSection ? `Повторяющиеся смысловые связи, на которые стоит смотреть в группе:\n${relationSection}` : '',
      ].filter(Boolean).join('\n\n'),
    };
  }, [globalMethodNote, groupTemplate?.content, individualTemplate?.content, linkView, nodes]);

  const nodePositions = useMemo(() => {
    const width = 860;
    const startX = 80;
    const endX = 520;
    const gapY = 138;
    const offsetY = 30;
    return nodes.map((node, index) => ({
      id: node.id,
      x: index % 2 === 0 ? startX : endX,
      y: offsetY + Math.floor(index / 2) * gapY,
    }));
  }, [nodes]);
  const canvasHeight = Math.max(300, 90 + Math.ceil(nodes.length / 2) * 138);

  function updateNode(id: string, patch: Partial<ResultNode>) {
    setStore((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node) => node.id === id ? { ...node, ...patch, updatedAt: nowIso() } : node),
    }));
  }

  function updateLink(id: string, patch: Partial<ResultLink>) {
    setStore((prev) => ({
      ...prev,
      links: prev.links.map((item) => item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item),
    }));
  }

  function addNode() {
    const item: ResultNode = {
      id: uid('node'),
      testSlug: TEST_OPTIONS[0].slug,
      label: 'Новый результат',
      value: '',
      note: '',
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setStore((prev) => ({ ...prev, nodes: [...prev.nodes, item] }));
    setSelectedNodeId(item.id);
    setNewLinkFrom(item.id);
    if (!newLinkTo) setNewLinkTo(item.id);
  }

  function removeNode() {
    if (!selectedNode) return;
    const nextNodes = nodes.filter((n) => n.id !== selectedNode.id);
    const nextLinks = links.filter((l) => l.fromNodeId !== selectedNode.id && l.toNodeId !== selectedNode.id);
    setStore((prev) => ({ ...prev, nodes: nextNodes, links: nextLinks }));
    setSelectedNodeId(nextNodes[0]?.id || '');
    setSelectedLinkId(nextLinks[0]?.id || '');
  }

  function addLink() {
    if (!newLinkFrom || !newLinkTo || newLinkFrom === newLinkTo) return;
    const item: ResultLink = {
      id: uid('link'),
      fromNodeId: newLinkFrom,
      toNodeId: newLinkTo,
      relationType: newLinkType,
      task: '',
      aiDraft: '',
      finalText: '',
      includeInPrompt: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setStore((prev) => ({ ...prev, links: [item, ...prev.links] }));
    setSelectedLinkId(item.id);
  }

  function removeLink() {
    if (!selectedLink) return;
    const next = links.filter((item) => item.id !== selectedLink.id);
    setStore((prev) => ({ ...prev, links: next }));
    setSelectedLinkId(next[0]?.id || '');
  }

  async function analyzeLinkWithAI() {
    if (!session || !selectedLink) return;
    const fromNode = nodes.find((n) => n.id === selectedLink.fromNodeId);
    const toNode = nodes.find((n) => n.id === selectedLink.toNodeId);
    if (!fromNode || !toNode) return;
    setAiBusy(true);
    setAiMsg('');
    try {
      const r = await fetch('/api/specialist/method-base/analyze-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          fromNode: { ...fromNode, testTitle: titleBySlug(fromNode.testSlug) },
          toNode: { ...toNode, testTitle: titleBySlug(toNode.testSlug) },
          relationType: selectedLink.relationType,
          task: selectedLink.task,
          context: globalMethodNote,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось получить анализ от ИИ');
      updateLink(selectedLink.id, { aiDraft: String(j.text || ''), finalText: normalizeText(selectedLink.finalText) || String(j.text || '') });
      setAiMsg('ИИ прислал черновой анализ ✅');
    } catch (e: any) {
      setAiMsg(e?.message || 'Ошибка');
    } finally {
      setAiBusy(false);
    }
  }

  async function applyPromptsToRoom() {
    if (!session || !selectedRoomId || !dashboard?.room?.name) return;
    setApplyBusy(true);
    setApplyMsg('');
    try {
      const r = await fetch('/api/training/rooms/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          room_id: selectedRoomId,
          name: dashboard.room.name,
          analysis_prompt: promptBody.individual,
          group_analysis_prompt: promptBody.group,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось применить промпты к комнате');
      setApplyMsg('Промты применены к комнате ✅');
    } catch (e: any) {
      setApplyMsg(e?.message || 'Ошибка');
    } finally {
      setApplyBusy(false);
    }
  }

  async function copyText(text: string, okText: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsg(okText);
      setTimeout(() => setCopiedMsg(''), 1800);
    } catch {
      setCopiedMsg('Не удалось скопировать');
      setTimeout(() => setCopiedMsg(''), 1800);
    }
  }

  async function importJsonFile(file: File) {
    const raw = await file.text();
    const parsed = safeParseStore(raw);
    setStore(parsed);
    setSelectedNodeId(parsed.nodes[0]?.id || '');
    setSelectedLinkId(parsed.links[0]?.id || '');
    setNewLinkFrom(parsed.nodes[0]?.id || '');
    setNewLinkTo(parsed.nodes[1]?.id || parsed.nodes[0]?.id || '');
  }

  if (!session || !user) {
    return <Layout title="Методическая база" widthClass="max-w-[1700px]"><div className="card text-sm text-zinc-700">Войдите, чтобы открыть методическую базу.<div className="mt-3"><Link href="/auth?next=%2Fspecialist%2Fmethod-base" className="btn btn-secondary btn-sm">Вход / регистрация</Link></div></div></Layout>;
  }
  if (!isSpecialistUser(user)) {
    return <Layout title="Методическая база" widthClass="max-w-[1700px]"><div className="card text-sm text-zinc-700">Эта страница доступна только специалисту.</div></Layout>;
  }

  return (
    <Layout title="Методическая база" widthClass="max-w-[1700px]">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/specialist/analysis" className="btn btn-secondary btn-sm">← AI-аналитика</Link>
        <div className="text-sm text-zinc-500">Методическая база теперь строится вокруг связей между конкретными результатами тестов.</div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[350px_minmax(0,1fr)_430px]">
        <aside className="space-y-5">
          <section className="card">
            <div className="text-xl font-semibold text-zinc-900">Связь с комнатой</div>
            <div className="mt-2 text-sm leading-6 text-zinc-500">Собирай рабочие связи здесь и сразу отправляй их в AI-аналитику комнаты.</div>
            <div className="mt-4 space-y-3">
              <select className={inputClass} value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)}>
                <option value="">Выбери комнату</option>
                {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
              </select>
              <div className="rounded-2xl border bg-white px-4 py-3 text-sm leading-7 text-zinc-600">
                {roomsLoading ? 'Загружаю комнаты…' : roomLoading ? 'Загружаю данные комнаты…' : dashboard?.room ? (
                  <>
                    <div className="font-medium text-zinc-900">{dashboard.room.name}</div>
                    <div>Текущий индивидуальный промпт: {dashboard.room.analysis_prompt ? `${dashboard.room.analysis_prompt.length} симв.` : 'пусто'}</div>
                    <div>Текущий групповой промпт: {dashboard.room.group_analysis_prompt ? `${dashboard.room.group_analysis_prompt.length} симв.` : 'пусто'}</div>
                  </>
                ) : 'Комната не выбрана.'}
              </div>
              <button className="btn btn-primary btn-md w-full" onClick={applyPromptsToRoom} disabled={!selectedRoomId || applyBusy}>{applyBusy ? 'Применяю…' : 'Применить к AI-аналитике комнаты'}</button>
              {applyMsg ? <div className="text-sm text-zinc-600">{applyMsg}</div> : null}
              {roomErr ? <div className="text-sm text-rose-600">{roomErr}</div> : null}
            </div>
          </section>

          <section className="card">
            <div className="text-xl font-semibold text-zinc-900">Результаты тестов</div>
            <div className="mt-2 text-sm leading-6 text-zinc-500">Сначала создавай отдельные результаты. Потом соединяй их связями и дописывай смысл.</div>
            <div className="mt-4 space-y-3">
              <button className="btn btn-secondary btn-sm" onClick={addNode}>+ Добавить результат</button>
              <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
                {nodes.map((node) => (
                  <button key={node.id} className={`w-full rounded-2xl border px-4 py-3 text-left ${selectedNodeId === node.id ? 'border-indigo-300 bg-indigo-50' : 'bg-white'}`} onClick={() => setSelectedNodeId(node.id)}>
                    <div className="text-sm font-semibold text-zinc-900">{node.label || 'Без названия'}</div>
                    <div className="mt-1 text-xs text-zinc-500">{titleBySlug(node.testSlug)}</div>
                    <div className="mt-1 text-xs text-zinc-500">{node.value || 'Без значения'}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="card">
            <div className="text-xl font-semibold text-zinc-900">Экспорт</div>
            <div className="mt-2 text-sm leading-6 text-zinc-500">Хранение пока локальное. Можно скачать, импортировать или сбросить пространство.</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => downloadJson('method-space.json', store)}>Скачать JSON</button>
              <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>Импорт JSON</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setStore(defaultStore); setSelectedNodeId(defaultStore.nodes[0]?.id || ''); setSelectedLinkId(defaultStore.links[0]?.id || ''); }}>Сбросить к демо</button>
              <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) importJsonFile(file); e.currentTarget.value = ''; }} />
            </div>
          </section>
        </aside>

        <main className="space-y-5">
          <section className="card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-2xl font-semibold text-zinc-900">Методическая база</div>
                <div className="mt-1 text-sm leading-6 text-zinc-500">Смысл теперь рождается не из голого промта, а из конкретных связей между результатами тестов.</div>
              </div>
              <div className="flex gap-2">
                <ButtonTab active={activeMode === 'map'} onClick={() => setActiveMode('map')}>Карта связей</ButtonTab>
                <ButtonTab active={activeMode === 'prompts'} onClick={() => setActiveMode('prompts')}>Промты</ButtonTab>
              </div>
            </div>
          </section>

          {activeMode === 'map' ? (
            <>
              <section className="card overflow-hidden">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold text-zinc-900">Карта результатов</div>
                    <div className="text-sm text-zinc-500">Ноды — это отдельные результаты. Линии — сохранённые связи между ними.</div>
                  </div>
                  <div className="text-sm text-zinc-500">Активных нод: {nodes.filter((n) => n.active).length} · Связей: {links.length}</div>
                </div>
                <div className="relative overflow-auto rounded-[28px] border bg-[linear-gradient(180deg,#fcfcff_0%,#f4f6ff_100%)]" style={{ minHeight: canvasHeight + 40 }}>
                  <svg width={860} height={canvasHeight} className="absolute left-0 top-0">
                    {linkView.map((row) => {
                      const from = nodePositions.find((p) => p.id === row.link.fromNodeId);
                      const to = nodePositions.find((p) => p.id === row.link.toNodeId);
                      if (!from || !to) return null;
                      const active = selectedLinkId === row.link.id;
                      return (
                        <g key={row.link.id} onClick={() => setSelectedLinkId(row.link.id)} style={{ cursor: 'pointer' }}>
                          <line x1={from.x + 130} y1={from.y + 48} x2={to.x + 130} y2={to.y + 48} stroke={active ? '#4f46e5' : '#94a3b8'} strokeWidth={active ? 3 : 2} strokeDasharray={active ? '0' : '6 5'} />
                        </g>
                      );
                    })}
                  </svg>
                  <div className="relative" style={{ width: 860, height: canvasHeight }}>
                    {nodes.map((node) => {
                      const pos = nodePositions.find((p) => p.id === node.id)!;
                      const selected = selectedNodeId === node.id;
                      return (
                        <button key={node.id} onClick={() => setSelectedNodeId(node.id)} className={`absolute w-[260px] rounded-[26px] border px-4 py-4 text-left shadow-sm transition ${selected ? 'border-indigo-300 bg-white shadow-[0_18px_50px_rgba(99,102,241,0.12)]' : 'border-zinc-200 bg-white/95 hover:border-zinc-300'}`} style={{ left: pos.x, top: pos.y }}>
                          <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">{titleBySlug(node.testSlug)}</div>
                          <div className="mt-2 text-base font-semibold text-zinc-900">{node.label || 'Новый результат'}</div>
                          <div className="mt-1 text-sm text-zinc-600">{node.value || 'Без значения'}</div>
                          <div className="mt-3 line-clamp-3 text-xs leading-5 text-zinc-500">{node.note || 'Добавь описание результата, чтобы связи с ним были осмысленными.'}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_370px]">
                <div className="card">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-zinc-900">Связи между результатами</div>
                      <div className="text-sm text-zinc-500">Соедини два результата, запроси черновик у ИИ, потом поправь и сохрани свой вывод.</div>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={addLink}>+ Связь</button>
                  </div>
                  <div className="mt-4 grid gap-3 rounded-3xl border bg-zinc-50/60 p-4 md:grid-cols-[1fr_1fr_170px_150px]">
                    <select className={inputClass} value={newLinkFrom} onChange={(e) => setNewLinkFrom(e.target.value)}>
                      <option value="">Результат 1</option>
                      {nodes.map((node) => <option key={node.id} value={node.id}>{titleBySlug(node.testSlug)} — {node.label || 'без названия'}</option>)}
                    </select>
                    <select className={inputClass} value={newLinkTo} onChange={(e) => setNewLinkTo(e.target.value)}>
                      <option value="">Результат 2</option>
                      {nodes.map((node) => <option key={node.id} value={node.id}>{titleBySlug(node.testSlug)} — {node.label || 'без названия'}</option>)}
                    </select>
                    <select className={inputClass} value={newLinkType} onChange={(e) => setNewLinkType(e.target.value)}>
                      {RELATION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <button className="btn btn-primary btn-sm" onClick={addLink} disabled={!newLinkFrom || !newLinkTo || newLinkFrom === newLinkTo}>Создать связь</button>
                  </div>
                  <div className="mt-4 space-y-3">
                    {linkView.length ? linkView.map((row) => {
                      const selected = selectedLinkId === row.link.id;
                      return (
                        <button key={row.link.id} className={`w-full rounded-3xl border px-4 py-4 text-left ${selected ? 'border-indigo-300 bg-indigo-50' : 'bg-white'}`} onClick={() => setSelectedLinkId(row.link.id)}>
                          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-400">
                            <span>{row.link.relationType}</span>
                            {row.link.includeInPrompt ? <span className="rounded-full bg-emerald-50 px-2 py-1 normal-case tracking-normal text-emerald-700">в промте</span> : null}
                          </div>
                          <div className="mt-2 text-base font-semibold text-zinc-900">{row.from?.label} ↔ {row.to?.label}</div>
                          <div className="mt-1 text-sm text-zinc-500">{titleBySlug(row.from?.testSlug || '')} ↔ {titleBySlug(row.to?.testSlug || '')}</div>
                          <div className="mt-3 line-clamp-3 text-sm leading-6 text-zinc-700">{normalizeText(row.link.finalText || row.link.aiDraft) || 'Пока нет вывода по этой связи.'}</div>
                        </button>
                      );
                    }) : <div className="rounded-3xl border bg-white px-4 py-6 text-sm text-zinc-500">Пока нет связей. Создай первую связку между двумя результатами.</div>}
                  </div>
                </div>

                <div className="card">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-zinc-900">Редактор</div>
                      <div className="text-sm text-zinc-500">Слева выбери результат или связь. Здесь идёт доработка смысла.</div>
                    </div>
                    {selectedLink ? <button className="btn btn-secondary btn-sm" onClick={removeLink}>Удалить связь</button> : selectedNode ? <button className="btn btn-secondary btn-sm" onClick={removeNode}>Удалить результат</button> : null}
                  </div>

                  {selectedLink ? (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl border bg-zinc-50 px-4 py-3 text-sm text-zinc-600">{titleBySlug(nodes.find((n) => n.id === selectedLink.fromNodeId)?.testSlug || '')} → {titleBySlug(nodes.find((n) => n.id === selectedLink.toNodeId)?.testSlug || '')}</div>
                      <select className={inputClass} value={selectedLink.relationType} onChange={(e) => updateLink(selectedLink.id, { relationType: e.target.value })}>
                        {RELATION_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                      <textarea className={areaClass} value={selectedLink.task} onChange={(e) => updateLink(selectedLink.id, { task: e.target.value })} placeholder="Что именно ИИ должен сделать с этой связью? Например: выяви риск управленческих качелей и что стоит проверить дополнительно." />
                      <button className="btn btn-primary btn-sm w-full" onClick={analyzeLinkWithAI} disabled={aiBusy}>{aiBusy ? 'Запрашиваю ИИ…' : 'Получить черновик от ИИ'}</button>
                      {aiMsg ? <div className="text-sm text-zinc-600">{aiMsg}</div> : null}
                      <textarea className="w-full min-h-[180px] resize-y rounded-2xl border bg-white px-4 py-3 text-sm leading-7" value={selectedLink.aiDraft} onChange={(e) => updateLink(selectedLink.id, { aiDraft: e.target.value })} placeholder="Здесь появится черновик от ИИ. Можно править вручную." />
                      <textarea className="w-full min-h-[220px] resize-y rounded-2xl border bg-white px-4 py-3 text-sm leading-7" value={selectedLink.finalText} onChange={(e) => updateLink(selectedLink.id, { finalText: e.target.value })} placeholder="Финальный вывод по этой связи. Именно он будет идти в сборщик промта." />
                      <label className="flex items-start gap-3 rounded-2xl border bg-white px-4 py-3 text-sm text-zinc-700"><input type="checkbox" checked={selectedLink.includeInPrompt} onChange={(e) => updateLink(selectedLink.id, { includeInPrompt: e.target.checked })} />Использовать эту связь в сборщике промта</label>
                    </div>
                  ) : selectedNode ? (
                    <div className="mt-4 space-y-3">
                      <select className={inputClass} value={selectedNode.testSlug} onChange={(e) => updateNode(selectedNode.id, { testSlug: e.target.value })}>
                        {TEST_OPTIONS.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}
                      </select>
                      <input className={inputClass} value={selectedNode.label} onChange={(e) => updateNode(selectedNode.id, { label: e.target.value })} placeholder="Название результата" />
                      <input className={inputClass} value={selectedNode.value} onChange={(e) => updateNode(selectedNode.id, { value: e.target.value })} placeholder="Число, уровень или короткая фиксация результата" />
                      <textarea className="w-full min-h-[220px] resize-y rounded-2xl border bg-white px-4 py-3 text-sm leading-7" value={selectedNode.note} onChange={(e) => updateNode(selectedNode.id, { note: e.target.value })} placeholder="Что именно в этом результате важно для последующих связей?" />
                      <label className="flex items-start gap-3 rounded-2xl border bg-white px-4 py-3 text-sm text-zinc-700"><input type="checkbox" checked={selectedNode.active} onChange={(e) => updateNode(selectedNode.id, { active: e.target.checked })} />Использовать этот результат в сборщике промта</label>
                    </div>
                  ) : <div className="mt-4 text-sm text-zinc-500">Выбери результат или связь.</div>}
                </div>
              </section>
            </>
          ) : (
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="card space-y-4">
                <div>
                  <div className="text-lg font-semibold text-zinc-900">Сборщик промта</div>
                  <div className="text-sm text-zinc-500">Ниже — то, что уже можно отправлять в AI-аналитику комнаты.</div>
                </div>
                <textarea className="w-full min-h-[140px] resize-y rounded-2xl border bg-white px-4 py-3 text-sm leading-7" value={globalMethodNote} onChange={(e) => setGlobalMethodNote(e.target.value)} placeholder="Общая методическая рамка. Например: не делать жёстких выводов по одному сочетанию, смотреть на устойчивость паттерна и рабочий контекст." />
                <div className="rounded-3xl border bg-zinc-50/70 p-4 text-sm leading-7 text-zinc-700">
                  <div className="font-semibold text-zinc-900">Что попадёт в промт</div>
                  <div className="mt-2">Активных результатов: {nodes.filter((n) => n.active).length}</div>
                  <div>Связей в сборщике: {linkView.filter((row) => row.link.includeInPrompt).length}</div>
                </div>
                {copiedMsg ? <div className="text-sm text-zinc-600">{copiedMsg}</div> : null}
              </div>

              <div className="space-y-5">
                <div className="card">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-zinc-900">Индивидуальный промт</div>
                      <div className="text-sm text-zinc-500">Для портрета одного участника.</div>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => copyText(promptBody.individual, 'Индивидуальный промт скопирован ✅')}>Копировать</button>
                  </div>
                  <textarea className="mt-4 w-full min-h-[320px] resize-y rounded-2xl border bg-white px-4 py-3 text-sm leading-7" value={promptBody.individual} readOnly />
                </div>
                <div className="card">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-zinc-900">Групповой промт</div>
                      <div className="text-sm text-zinc-500">Для анализа команды или комнаты.</div>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => copyText(promptBody.group, 'Групповой промт скопирован ✅')}>Копировать</button>
                  </div>
                  <textarea className="mt-4 w-full min-h-[260px] resize-y rounded-2xl border bg-white px-4 py-3 text-sm leading-7" value={promptBody.group} readOnly />
                </div>
              </div>
            </section>
          )}
        </main>

        <aside className="space-y-5">
          <section className="card">
            <div className="text-lg font-semibold text-zinc-900">Как этим пользоваться</div>
            <div className="mt-3 space-y-3 text-sm leading-7 text-zinc-600">
              <div><span className="font-semibold text-zinc-900">1.</span> Добавь отдельные результаты тестов как самостоятельные ноды.</div>
              <div><span className="font-semibold text-zinc-900">2.</span> Соедини два результата связью и уточни, что именно ИИ должен в ней увидеть.</div>
              <div><span className="font-semibold text-zinc-900">3.</span> Возьми черновик от ИИ, перепиши его под свою методику и сохрани финальный вывод.</div>
              <div><span className="font-semibold text-zinc-900">4.</span> Только после этого отправляй выводы в AI-аналитику комнаты.</div>
            </div>
          </section>

          <section className="card">
            <div className="text-lg font-semibold text-zinc-900">Русские названия тестов</div>
            <div className="mt-3 max-h-[340px] space-y-2 overflow-auto pr-1 text-sm leading-6 text-zinc-600">
              {TEST_OPTIONS.map((item) => <div key={item.slug} className="rounded-2xl border bg-white px-4 py-3"><div className="font-medium text-zinc-900">{item.title}</div><div className="text-xs text-zinc-500">{item.slug}</div></div>)}
            </div>
          </section>
        </aside>
      </div>
    </Layout>
  );
}
