import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { useSession } from '@/lib/useSession';
import { isSpecialistUser } from '@/lib/specialist';

type MethodResultOption = {
  key: string;
  label: string;
  group?: string;
  suggestedValues: string[];
  description?: string;
};

type CatalogTest = {
  slug: string;
  title: string;
  resultOptions: MethodResultOption[];
};

type DraftItem = {
  localId: string;
  testSlug: string;
  testTitle: string;
  resultKey: string;
  resultLabel: string;
  answerValue: string;
  answerNote: string;
  suggestedValues: string[];
};

type SavedLink = {
  id: string;
  title: string;
  ai_task: string;
  ai_draft: string;
  final_text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  items: Array<{
    id?: string;
    link_id?: string;
    sort_order?: number;
    test_slug: string;
    test_title: string;
    result_key: string;
    result_label: string;
    answer_value: string;
    answer_note: string;
  }>;
};

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function emptyDraft() {
  return {
    editingId: '',
    title: '',
    aiTask: '',
    aiDraft: '',
    finalText: '',
    isActive: true,
    items: [] as DraftItem[],
  };
}

const panelTitleClass = 'text-lg font-semibold tracking-tight text-slate-900';

export default function SpecialistMethodBasePage() {
  const { session, user } = useSession();

  const [catalog, setCatalog] = useState<CatalogTest[]>([]);
  const [selectedTestSlugs, setSelectedTestSlugs] = useState<string[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [linksLoading, setLinksLoading] = useState(false);
  const [busyAi, setBusyAi] = useState(false);
  const [busySave, setBusySave] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [missingMigration, setMissingMigration] = useState(false);
  const [savedLinks, setSavedLinks] = useState<SavedLink[]>([]);
  const [draft, setDraft] = useState(emptyDraft());
  const [openDescriptions, setOpenDescriptions] = useState<Record<string, boolean>>({});

  const authorized = Boolean(session && user && isSpecialistUser(user));

  async function loadCatalog() {
    if (!session) return;
    setCatalogLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/specialist/method-base/catalog', {
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось загрузить каталог тестов');
      setCatalog(Array.isArray(j.tests) ? j.tests : []);
    } catch (e: any) {
      setErr(e?.message || 'Ошибка загрузки каталога');
    } finally {
      setCatalogLoading(false);
    }
  }

  async function loadLinks() {
    if (!session) return;
    setLinksLoading(true);
    setErr('');
    try {
      const r = await fetch('/api/specialist/method-base/links', {
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось загрузить сохранённые связи');
      setSavedLinks(Array.isArray(j.links) ? j.links : []);
      setMissingMigration(Boolean(j.missing_migration));
    } catch (e: any) {
      setErr(e?.message || 'Ошибка загрузки связей');
    } finally {
      setLinksLoading(false);
    }
  }

  useEffect(() => {
    if (!authorized) return;
    loadCatalog();
    loadLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, session?.access_token]);

  const selectedTests = useMemo(
    () => catalog.filter((test) => selectedTestSlugs.includes(test.slug)),
    [catalog, selectedTestSlugs]
  );

  const uniqueDraftTestCount = useMemo(
    () => new Set(draft.items.map((item) => item.testSlug)).size,
    [draft.items]
  );

  function resetDraft(keepTests = false) {
    setDraft(emptyDraft());
    setMsg('');
    if (!keepTests) setSelectedTestSlugs([]);
  }

  function toggleTest(slug: string) {
    setSelectedTestSlugs((prev) => (prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug]));
  }

  function toggleDescription(testSlug: string, resultKey: string) {
    const id = `${testSlug}::${resultKey}`;
    setOpenDescriptions((prev) => ({ ...prev, [id]: !prev[id] }));
  }


  function addResultToDraft(test: CatalogTest, option: MethodResultOption) {
    setDraft((prev) => {
      const exists = prev.items.some((item) => item.testSlug === test.slug && item.resultKey === option.key);
      if (exists) return prev;
      return {
        ...prev,
        items: [
          ...prev.items,
          {
            localId: uid('item'),
            testSlug: test.slug,
            testTitle: test.title,
            resultKey: option.key,
            resultLabel: option.label,
            answerValue: '',
            answerNote: '',
            suggestedValues: option.suggestedValues || [],
          },
        ],
      };
    });
    setSelectedTestSlugs((prev) => (prev.includes(test.slug) ? prev : [...prev, test.slug]));
  }

  function removeDraftItem(localId: string) {
    setDraft((prev) => ({ ...prev, items: prev.items.filter((item) => item.localId !== localId) }));
  }

  function updateDraftItem(localId: string, patch: Partial<DraftItem>) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.localId === localId ? { ...item, ...patch } : item)),
    }));
  }

  function hydrateDraftFromSaved(link: SavedLink) {
    setDraft({
      editingId: link.id,
      title: link.title || '',
      aiTask: link.ai_task || '',
      aiDraft: link.ai_draft || '',
      finalText: link.final_text || '',
      isActive: link.is_active !== false,
      items: (link.items || []).map((item) => ({
        localId: uid('item'),
        testSlug: item.test_slug,
        testTitle: item.test_title,
        resultKey: item.result_key,
        resultLabel: item.result_label,
        answerValue: item.answer_value || '',
        answerNote: item.answer_note || '',
        suggestedValues:
          catalog.find((test) => test.slug === item.test_slug)?.resultOptions.find((opt) => opt.key === item.result_key)?.suggestedValues || [],
      })),
    });
    setSelectedTestSlugs(Array.from(new Set((link.items || []).map((item) => item.test_slug).filter(Boolean))));
    setMsg('');
    setErr('');
  }

  async function analyzeDraft() {
    if (!session) return;
    if (draft.items.length < 2 || uniqueDraftTestCount < 2) {
      setErr('Сначала выбери минимум 2 результата из разных тестов');
      return;
    }
    setBusyAi(true);
    setErr('');
    setMsg('');
    try {
      const r = await fetch('/api/specialist/method-base/analyze-link', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          task: draft.aiTask,
          items: draft.items.map((item) => ({
            testSlug: item.testSlug,
            testTitle: item.testTitle,
            resultKey: item.resultKey,
            resultLabel: item.resultLabel,
            answerValue: item.answerValue,
            answerNote: item.answerNote,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось получить черновик от ИИ');
      setDraft((prev) => ({ ...prev, aiDraft: String(j.text || '').trim() }));
      setMsg('ИИ-черновик обновлён');
    } catch (e: any) {
      setErr(e?.message || 'Ошибка при генерации от ИИ');
    } finally {
      setBusyAi(false);
    }
  }

  async function saveDraft() {
    if (!session) return;
    if (draft.items.length < 2 || uniqueDraftTestCount < 2) {
      setErr('Для сохранения нужна связь минимум между 2 результатами из разных тестов');
      return;
    }
    setBusySave(true);
    setErr('');
    setMsg('');
    try {
      const r = await fetch('/api/specialist/method-base/link-save', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          id: draft.editingId,
          title: draft.title,
          aiTask: draft.aiTask,
          aiDraft: draft.aiDraft,
          finalText: draft.finalText,
          isActive: draft.isActive,
          items: draft.items.map((item) => ({
            test_slug: item.testSlug,
            test_title: item.testTitle,
            result_key: item.resultKey,
            result_label: item.resultLabel,
            answer_value: item.answerValue,
            answer_note: item.answerNote,
          })),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось сохранить связь');
      await loadLinks();
      setMsg('Связь сохранена в базу');
      setDraft((prev) => ({ ...prev, editingId: String(j.id || prev.editingId || '') }));
    } catch (e: any) {
      setErr(e?.message || 'Ошибка сохранения');
    } finally {
      setBusySave(false);
    }
  }

  async function deleteCurrent() {
    if (!session || !draft.editingId) return;
    const ok = window.confirm('Удалить эту сохранённую связь?');
    if (!ok) return;
    setBusyDelete(true);
    setErr('');
    setMsg('');
    try {
      const r = await fetch('/api/specialist/method-base/link-delete', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ id: draft.editingId }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'Не удалось удалить связь');
      await loadLinks();
      resetDraft(true);
      setMsg('Связь удалена');
    } catch (e: any) {
      setErr(e?.message || 'Ошибка удаления');
    } finally {
      setBusyDelete(false);
    }
  }

  if (!session || !user) {
    return (
      <Layout title="Методическая база" widthClass="max-w-[1700px]">
        <div className="card text-sm text-zinc-700">
          Войдите, чтобы открыть методическую базу специалиста.
          <div className="mt-3">
            <Link href="/auth?next=%2Fspecialist%2Fmethod-base" className="btn btn-secondary btn-sm">
              Вход / регистрация
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isSpecialistUser(user)) {
    return (
      <Layout title="Методическая база" widthClass="max-w-[1700px]">
        <div className="card text-sm text-zinc-700">Этот раздел доступен только специалисту.</div>
      </Layout>
    );
  }

  return (
    <Layout title="Методическая база" widthClass="max-w-[1700px]">
      <div className="card mb-6">
        <div className={panelTitleClass}>Рабочее пространство связей между тестами</div>
        <div className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
          Здесь ты выбираешь тесты, видишь их показатели, соединяешь 2 и более результата из разных тестов,
          просишь у ИИ черновой анализ сочетания, потом правишь текст вручную и сохраняешь это уже как свою методическую связку.
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/specialist" className="btn btn-secondary btn-sm">Назад в кабинет специалиста</Link>
          <Link href="/specialist/analysis" className="btn btn-secondary btn-sm">AI-аналитика клиентов</Link>
          <button onClick={() => { resetDraft(false); setErr(''); }} className="btn btn-secondary btn-sm">Новая связь</button>
          <button onClick={() => { loadCatalog(); loadLinks(); }} disabled={catalogLoading || linksLoading} className="btn btn-secondary btn-sm">
            {catalogLoading || linksLoading ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
        {missingMigration ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Таблицы методической базы ещё не созданы в Supabase. Примени SQL из файла <code>supabase/specialist_method_base.sql</code>.
          </div>
        ) : null}
        {err ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div> : null}
        {msg ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{msg}</div> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="grid gap-6 xl:sticky xl:top-4 xl:self-start">
          <div className="card">
            <div className={panelTitleClass}>Сохранённые связи</div>
            <div className="mt-2 text-sm text-slate-600">Здесь лежат уже сохранённые сочетания результатов. Открой любую карточку, чтобы править её дальше.</div>
            <div className="mt-4 space-y-3 max-h-[70vh] overflow-auto pr-1">
              {linksLoading ? <div className="text-sm text-slate-500">Загрузка…</div> : null}
              {!linksLoading && !savedLinks.length ? <div className="text-sm text-slate-500">Пока нет сохранённых связей.</div> : null}
              {savedLinks.map((link) => {
                const isSelected = draft.editingId === link.id;
                return (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => hydrateDraftFromSaved(link)}
                    className={`w-full rounded-2xl border p-4 text-left shadow-sm transition ${isSelected ? 'border-indigo-300 bg-indigo-50/80' : 'border-indigo-100 bg-white hover:bg-indigo-50/40'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="line-clamp-2 text-sm font-semibold text-slate-900">{link.title || 'Без названия'}</div>
                        <div className="mt-1 text-xs text-slate-500">{new Date(link.updated_at).toLocaleString()}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${link.is_active ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-zinc-200 bg-zinc-50 text-zinc-500'}`}>
                        {link.is_active ? 'активно' : 'скрыто'}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(link.items || []).slice(0, 4).map((item, idx) => (
                        <span key={`${link.id}_${idx}`} className="rounded-full border border-indigo-100 bg-white px-2.5 py-1 text-[11px] text-slate-700">
                          {item.test_title}: {item.result_label}
                        </span>
                      ))}
                      {(link.items || []).length > 4 ? <span className="text-[11px] text-slate-500">+{(link.items || []).length - 4}</span> : null}
                    </div>
                    {link.final_text ? <div className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{link.final_text}</div> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="grid gap-6">
          <div className="card">
            <div className={panelTitleClass}>1. Выбор тестов</div>
            <div className="mt-2 text-sm text-slate-600">Сначала отметь тесты, из которых хочешь собирать сочетание.</div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {catalog.map((test) => {
                const selected = selectedTestSlugs.includes(test.slug);
                return (
                  <button
                    key={test.slug}
                    type="button"
                    onClick={() => toggleTest(test.slug)}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${selected ? 'border-indigo-300 bg-indigo-100/80 text-indigo-950' : 'border-indigo-100 bg-white hover:bg-indigo-50/40'}`}
                  >
                    <div className="text-sm font-semibold">{test.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{test.resultOptions.length} показателей</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <section className="card min-w-0">
              <div className={panelTitleClass}>2. Показатели выбранных тестов</div>
              <div className="mt-2 text-sm text-slate-600">Нажми «Добавить в связь», чтобы перенести нужный показатель в рабочее поле справа.</div>

              {!selectedTests.length ? <div className="mt-6 text-sm text-slate-500">Пока не выбрано ни одного теста.</div> : null}

              <div className="mt-4 grid gap-4">
                {selectedTests.map((test) => {
                  const grouped = test.resultOptions.reduce<Record<string, MethodResultOption[]>>((acc, option) => {
                    const key = option.group || 'Показатели';
                    acc[key] = acc[key] || [];
                    acc[key].push(option);
                    return acc;
                  }, {});

                  return (
                    <div key={test.slug} className="rounded-3xl border border-indigo-100 bg-white/80 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-slate-900">{test.title}</div>
                          <div className="mt-1 text-xs text-slate-500">Выбери показатели, которые хочешь соединить с другими тестами.</div>
                        </div>
                        <button type="button" onClick={() => setSelectedTestSlugs((prev) => prev.filter((slug) => slug !== test.slug))} className="btn btn-secondary btn-sm">
                          Скрыть
                        </button>
                      </div>

                      <div className="mt-4 space-y-4">
                        {Object.entries(grouped).map(([group, options]) => (
                          <div key={group}>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{group}</div>
                            <div className="grid gap-3 lg:grid-cols-2">
                              {options.map((option) => {
                                const alreadyAdded = draft.items.some((item) => item.testSlug === test.slug && item.resultKey === option.key);
                                const descriptionId = `${test.slug}::${option.key}`;
                                const descriptionOpen = Boolean(openDescriptions[descriptionId]);
                                return (
                                  <div key={option.key} className="rounded-2xl border border-indigo-100 bg-slate-50/70 p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium text-slate-900">{option.label}</div>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                          {(option.suggestedValues || []).slice(0, 4).map((value) => (
                                            <span key={value} className="rounded-full border border-indigo-100 bg-white px-2 py-1 text-[11px] text-slate-600">{value}</span>
                                          ))}
                                        </div>
                                      </div>
                                      {option.description ? (
                                        <button
                                          type="button"
                                          onClick={() => toggleDescription(test.slug, option.key)}
                                          className="btn btn-secondary btn-sm shrink-0"
                                        >
                                          {descriptionOpen ? 'Скрыть описание' : 'Описание'}
                                        </button>
                                      ) : null}
                                    </div>
                                    {option.description && descriptionOpen ? (
                                      <div className="mt-3 rounded-2xl border border-indigo-100 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                                        {option.description}
                                      </div>
                                    ) : null}
                                    <button
                                      type="button"
                                      disabled={alreadyAdded}
                                      onClick={() => addResultToDraft(test, option)}
                                      className="btn btn-secondary btn-sm mt-3"
                                    >
                                      {alreadyAdded ? 'Уже в связи' : 'Добавить в связь'}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="card min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className={panelTitleClass}>3. Связь и итоговый вывод</div>
                  <div className="mt-2 text-sm text-slate-600">Собери 2 и более результатов из разных тестов, попроси ИИ дать черновой смысл, потом отредактируй и сохрани.</div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft((prev) => ({ ...prev, isActive: e.target.checked }))} />
                  Использовать эту связь дальше
                </label>
              </div>

              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Название связи</div>
                <input value={draft.title} onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))} className="input mt-2" placeholder="Например: полярное руководство + низкая саморегуляция" />
              </div>

              <div className="mt-5 rounded-3xl border border-indigo-100 bg-indigo-50/40 p-4">
                <div className="text-sm font-semibold text-slate-900">Связанные результаты</div>
                <div className="mt-2 text-sm text-slate-600">Здесь держи только те показатели, между которыми реально хочешь сформулировать методический вывод.</div>
                {!draft.items.length ? <div className="mt-4 text-sm text-slate-500">Пока сюда ничего не добавлено.</div> : null}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {draft.items.map((item, index) => (
                    <>
                      {index > 0 ? <div className="h-[2px] w-8 rounded-full bg-indigo-300" /> : null}
                      <div key={item.localId} className="min-w-[220px] max-w-[320px] flex-1 rounded-2xl border border-indigo-200 bg-white p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[11px] uppercase tracking-[0.08em] text-slate-500">{item.testTitle}</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{item.resultLabel}</div>
                          </div>
                          <button type="button" onClick={() => removeDraftItem(item.localId)} className="btn btn-secondary btn-sm">Убрать</button>
                        </div>
                        <div className="mt-3">
                          <div className="text-xs font-medium text-slate-600">Какой именно ответ / уровень ты связываешь</div>
                          <input
                            value={item.answerValue}
                            onChange={(e) => updateDraftItem(item.localId, { answerValue: e.target.value })}
                            className="input mt-2"
                            placeholder="Например: низкий / высокий / выражен / ведущий"
                          />
                          {item.suggestedValues.length ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {item.suggestedValues.map((value) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => updateDraftItem(item.localId, { answerValue: value })}
                                  className={`rounded-full border px-2.5 py-1 text-[11px] ${item.answerValue === value ? 'border-indigo-300 bg-indigo-100 text-indigo-950' : 'border-indigo-100 bg-white text-slate-600 hover:bg-indigo-50'}`}
                                >
                                  {value}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-3">
                          <div className="text-xs font-medium text-slate-600">Уточнение / заметка</div>
                          <textarea
                            value={item.answerNote}
                            onChange={(e) => updateDraftItem(item.localId, { answerNote: e.target.value })}
                            className="textarea mt-2 min-h-[110px]"
                            placeholder="Что именно здесь важно: полярность, конфликт, дефицит гибкости, выраженный ресурс и т.д."
                          />
                        </div>
                      </div>
                    </>
                  ))}
                </div>
                <div className="mt-4 text-xs text-slate-500">Сейчас в связи: {draft.items.length} показателей · тестов: {uniqueDraftTestCount}</div>
              </div>

              <div className="mt-5 grid gap-5">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Задача для ИИ</div>
                  <textarea
                    value={draft.aiTask}
                    onChange={(e) => setDraft((prev) => ({ ...prev, aiTask: e.target.value }))}
                    className="textarea mt-2 min-h-[120px]"
                    placeholder="Например: опиши общий смысл сочетания, возможные поведенческие проявления и риски ошибки интерпретации."
                  />
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Черновик от ИИ</div>
                      <div className="mt-1 text-sm text-slate-600">Сначала генерируй отсюда набросок, потом уже правь его под себя.</div>
                    </div>
                    <button onClick={analyzeDraft} disabled={busyAi || draft.items.length < 2 || uniqueDraftTestCount < 2} className="btn btn-primary btn-sm">
                      {busyAi ? 'Генерация…' : 'Сгенерировать от ИИ'}
                    </button>
                  </div>
                  <textarea
                    value={draft.aiDraft}
                    onChange={(e) => setDraft((prev) => ({ ...prev, aiDraft: e.target.value }))}
                    className="textarea mt-2 min-h-[220px]"
                    placeholder="Здесь появится черновик от ИИ. Его можно редактировать вручную."
                  />
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Финальный вывод специалиста</div>
                  <textarea
                    value={draft.finalText}
                    onChange={(e) => setDraft((prev) => ({ ...prev, finalText: e.target.value }))}
                    className="textarea mt-2 min-h-[220px]"
                    placeholder="Финальный текст, который ты считаешь уже своей рабочей методической формулировкой."
                  />
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <button onClick={saveDraft} disabled={busySave || draft.items.length < 2 || uniqueDraftTestCount < 2} className="btn btn-primary">
                  {busySave ? 'Сохранение…' : draft.editingId ? 'Сохранить изменения в базу' : 'Сохранить связь в базу'}
                </button>
                <button onClick={() => resetDraft(true)} className="btn btn-secondary">
                  Очистить рабочее поле
                </button>
                {draft.editingId ? (
                  <button onClick={deleteCurrent} disabled={busyDelete} className="btn btn-secondary">
                    {busyDelete ? 'Удаление…' : 'Удалить связь'}
                  </button>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </div>
    </Layout>
  );
}
