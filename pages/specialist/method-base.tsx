import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";
import { isSpecialistUser } from "@/lib/specialist";

type Room = {
  id: string;
  name: string;
  created_at: string;
  is_active: boolean;
};

type DashboardPayload = {
  room?: { id: string; name: string; analysis_prompt?: string; group_analysis_prompt?: string };
};

type MethodRule = {
  id: string;
  title: string;
  tests: string;
  condition: string;
  interpretation: string;
  clientText: string;
  specialistText: string;
  priority: number;
  active: boolean;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
};

type Combination = {
  id: string;
  title: string;
  tests: string;
  pattern: string;
  hypothesis: string;
  risks: string;
  recommendations: string;
  clientText: string;
  specialistText: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type PromptTemplate = {
  id: string;
  title: string;
  type: "individual" | "group";
  content: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type CaptureNote = {
  id: string;
  title: string;
  text: string;
  linkedTests: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type MethodBaseStore = {
  rules: MethodRule[];
  combinations: Combination[];
  templates: PromptTemplate[];
  notes: CaptureNote[];
};

type TabKey = "rules" | "combinations" | "templates" | "builder";

const STORAGE_KEY = "specialist-method-base-v1";

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

const defaultStore: MethodBaseStore = {
  rules: [
    {
      id: uid("rule"),
      title: "Полярное руководство и низкая гибкость",
      tests: "situational-guidance, emin, time-management",
      condition: "Если выражены противоположные стили руководства, а промежуточные стили ослаблены, фиксируй риск качелей между контролем и отстранением.",
      interpretation: "Вероятен контрастный стиль управления: человек может метаться между жёстким давлением и резким снятием контроля, особенно в стрессе.",
      clientText: "Ваш стиль может становиться слишком контрастным: в одних ситуациях вы усиливаете контроль, а в других — слишком быстро отходите в сторону.",
      specialistText: "Смотреть на управленческую ригидность, устойчивость к фрустрации и дефицит промежуточных поведенческих режимов.",
      priority: 90,
      active: true,
      verified: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ],
  combinations: [
    {
      id: uid("combo"),
      title: "Высокая чувствительность + слабая саморегуляция",
      tests: "emin, 16pf-a",
      pattern: "Если эмоциональная чувствительность высока, а управление собственными реакциями снижено, смотри риск эмоциональной перегрузки.",
      hypothesis: "Человек хорошо считывает атмосферу и сигналы среды, но может быстро накапливать внутреннее напряжение и терять устойчивость в конфликтах.",
      risks: "Перегрев в межличностных напряжениях, быстрая усталость, эмоциональная реактивность.",
      recommendations: "Подсветить саморегуляцию, паузы перед реакцией, режим восстановления, управляемость границ.",
      clientText: "Вы тонко улавливаете эмоциональный фон, но важно учиться не прожигать себя чужими состояниями.",
      specialistText: "Не путать эмпатию с зрелой регуляцией. Проверять устойчивость в нагрузке и конфликтах.",
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ],
  templates: [
    {
      id: uid("tpl"),
      title: "Индивидуальный профиль — деловой и ясный",
      type: "individual",
      content: "Дай структурированный анализ личности и рабочих паттернов. Отдельно выдели сильные стороны, риски, внутренние противоречия, рекомендации для сопровождения и аккуратный текст для клиента без клинических ярлыков.",
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: uid("tpl"),
      title: "Групповой профиль — команда и управление",
      type: "group",
      content: "Опиши общую динамику группы, повторяющиеся сильные стороны, управленческие риски, слепые зоны команды, рекомендации по распределению ролей, обучению и коммуникации.",
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ],
  notes: [],
};

function safeParseStore(raw: string | null): MethodBaseStore {
  if (!raw) return defaultStore;
  try {
    const parsed = JSON.parse(raw);
    return {
      rules: Array.isArray(parsed?.rules) ? parsed.rules : defaultStore.rules,
      combinations: Array.isArray(parsed?.combinations) ? parsed.combinations : defaultStore.combinations,
      templates: Array.isArray(parsed?.templates) ? parsed.templates : defaultStore.templates,
      notes: Array.isArray(parsed?.notes) ? parsed.notes : defaultStore.notes,
    };
  } catch {
    return defaultStore;
  }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normalizeText(value: string) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-zinc-900">{title}</div>
      {note ? <div className="mt-1 text-xs text-zinc-500">{note}</div> : null}
    </div>
  );
}

export default function SpecialistMethodBasePage() {
  const { session, user } = useSession();
  const router = useRouter();
  const roomIdFromQuery = typeof router.query.room_id === "string" ? router.query.room_id : "";

  const [tab, setTab] = useState<TabKey>("rules");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsErr, setRoomsErr] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomErr, setRoomErr] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");

  const [store, setStore] = useState<MethodBaseStore>(defaultStore);
  const [hydrated, setHydrated] = useState(false);

  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [selectedCombinationId, setSelectedCombinationId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [captureTitle, setCaptureTitle] = useState("");
  const [captureTests, setCaptureTests] = useState("");
  const [captureText, setCaptureText] = useState("");
  const [builderNote, setBuilderNote] = useState("");
  const [individualTemplateId, setIndividualTemplateId] = useState("");
  const [groupTemplateId, setGroupTemplateId] = useState("");
  const [builderIndividualIntro, setBuilderIndividualIntro] = useState("");
  const [builderGroupIntro, setBuilderGroupIntro] = useState("");
  const [copiedMsg, setCopiedMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!roomIdFromQuery) return;
    setSelectedRoomId(roomIdFromQuery);
  }, [roomIdFromQuery]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const parsed = safeParseStore(window.localStorage.getItem(STORAGE_KEY));
    setStore(parsed);
    setSelectedRuleId(parsed.rules[0]?.id || "");
    setSelectedCombinationId(parsed.combinations[0]?.id || "");
    setSelectedTemplateId(parsed.templates[0]?.id || "");
    setIndividualTemplateId(parsed.templates.find((t) => t.type === "individual" && t.active)?.id || parsed.templates.find((t) => t.type === "individual")?.id || "");
    setGroupTemplateId(parsed.templates.find((t) => t.type === "group" && t.active)?.id || parsed.templates.find((t) => t.type === "group")?.id || "");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }, [hydrated, store]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const loadRooms = async () => {
      setRoomsLoading(true);
      setRoomsErr("");
      try {
        const r = await fetch("/api/training/rooms/my", {
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить комнаты");
        if (cancelled) return;
        const nextRooms = Array.isArray(j.rooms) ? (j.rooms as Room[]) : [];
        setRooms(nextRooms);
        if (!selectedRoomId && !roomIdFromQuery && nextRooms[0]?.id) {
          setSelectedRoomId(nextRooms[0].id);
        }
      } catch (e: any) {
        if (!cancelled) setRoomsErr(e?.message || "Ошибка");
      } finally {
        if (!cancelled) setRoomsLoading(false);
      }
    };
    loadRooms();
    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (!session || !selectedRoomId) {
      setDashboard(null);
      return;
    }
    let cancelled = false;
    const loadDashboard = async () => {
      setRoomLoading(true);
      setRoomErr("");
      try {
        const r = await fetch(`/api/training/rooms/dashboard?room_id=${encodeURIComponent(selectedRoomId)}`, {
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить комнату");
        if (cancelled) return;
        setDashboard(j);
      } catch (e: any) {
        if (!cancelled) {
          setDashboard(null);
          setRoomErr(e?.message || "Ошибка");
        }
      } finally {
        if (!cancelled) setRoomLoading(false);
      }
    };
    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [session?.access_token, selectedRoomId]);

  const activeRules = useMemo(
    () => [...store.rules].filter((item) => item.active).sort((a, b) => b.priority - a.priority),
    [store.rules]
  );
  const activeCombinations = useMemo(() => store.combinations.filter((item) => item.active), [store.combinations]);
  const activeTemplates = useMemo(() => store.templates.filter((item) => item.active), [store.templates]);
  const activeNotes = useMemo(() => store.notes.filter((item) => item.active), [store.notes]);

  const individualTemplate = store.templates.find((t) => t.id === individualTemplateId) || null;
  const groupTemplate = store.templates.find((t) => t.id === groupTemplateId) || null;

  const selectedRule = store.rules.find((item) => item.id === selectedRuleId) || null;
  const selectedCombination = store.combinations.find((item) => item.id === selectedCombinationId) || null;
  const selectedTemplate = store.templates.find((item) => item.id === selectedTemplateId) || null;

  const generatedIndividualPrompt = useMemo(() => {
    const parts: string[] = [];
    parts.push("Ты анализируешь результаты участника, используя методическую базу специалиста. Не выдумывай факты, опирайся на реальные результаты тестов и активные экспертные правила.");
    if (normalizeText(builderIndividualIntro)) parts.push(`Дополнительная рамка специалиста:\n${normalizeText(builderIndividualIntro)}`);
    if (individualTemplate?.content) parts.push(`Шаблон интерпретации:\n${normalizeText(individualTemplate.content)}`);
    if (activeRules.length) {
      parts.push(
        "Активные правила интерпретации:\n" +
          activeRules
            .map((item, index) =>
              `${index + 1}. ${item.title}\nТесты: ${item.tests || "—"}\nУсловие: ${item.condition || "—"}\nСмысл: ${item.interpretation || "—"}\nДля специалиста: ${item.specialistText || "—"}\nДля клиента: ${item.clientText || "—"}`
            )
            .join("\n\n")
      );
    }
    if (activeCombinations.length) {
      parts.push(
        "Активные сочетания между тестами:\n" +
          activeCombinations
            .map((item, index) =>
              `${index + 1}. ${item.title}\nТесты: ${item.tests || "—"}\nПаттерн: ${item.pattern || "—"}\nГипотеза: ${item.hypothesis || "—"}\nРиски: ${item.risks || "—"}\nРекомендации: ${item.recommendations || "—"}`
            )
            .join("\n\n")
      );
    }
    if (activeNotes.length) {
      parts.push(
        "Практические наблюдения специалиста:\n" +
          activeNotes
            .map((item, index) => `${index + 1}. ${item.title || `Наблюдение ${index + 1}`}\nТесты: ${item.linkedTests || "—"}\nСмысл: ${item.text}`)
            .join("\n\n")
      );
    }
    parts.push("В ответе отдельно выдели: сильные стороны, риски, внутренние противоречия, рекомендации для сопровождения и краткий клиентский текст без резких ярлыков.");
    return parts.join("\n\n");
  }, [activeCombinations, activeNotes, activeRules, builderIndividualIntro, individualTemplate]);

  const generatedGroupPrompt = useMemo(() => {
    const parts: string[] = [];
    parts.push("Ты анализируешь группу участников на основе результатов их тестов и методической базы специалиста. Ищи повторяющиеся паттерны, различия, риски для групповой динамики и рекомендации по управлению/обучению.");
    if (normalizeText(builderGroupIntro)) parts.push(`Дополнительная рамка специалиста:\n${normalizeText(builderGroupIntro)}`);
    if (groupTemplate?.content) parts.push(`Шаблон групповой интерпретации:\n${normalizeText(groupTemplate.content)}`);
    if (activeRules.length) {
      parts.push(
        "Правила, которые можно учитывать на уровне группы:\n" +
          activeRules
            .map((item, index) => `${index + 1}. ${item.title}\nТесты: ${item.tests || "—"}\nСмысл: ${item.interpretation || "—"}`)
            .join("\n\n")
      );
    }
    if (activeCombinations.length) {
      parts.push(
        "Сочетания и рабочие гипотезы специалиста:\n" +
          activeCombinations
            .map((item, index) => `${index + 1}. ${item.title}\nПаттерн: ${item.pattern || "—"}\nРиски: ${item.risks || "—"}\nРекомендации: ${item.recommendations || "—"}`)
            .join("\n\n")
      );
    }
    if (activeNotes.length) {
      parts.push(
        "Практические наблюдения специалиста:\n" +
          activeNotes
            .map((item, index) => `${index + 1}. ${item.title || `Наблюдение ${index + 1}`}\n${item.text}`)
            .join("\n\n")
      );
    }
    parts.push("В ответе отдельно выдели: общую картину группы, сильные стороны, риски, различия между участниками, рекомендации по роли/коммуникации/обучению.");
    return parts.join("\n\n");
  }, [activeCombinations, activeNotes, activeRules, builderGroupIntro, groupTemplate]);



  const previewIndividualPrompt = useMemo(() => {
    const note = normalizeText(builderNote);
    return note ? `${generatedIndividualPrompt}

Дополнительное наблюдение специалиста:
${note}` : generatedIndividualPrompt;
  }, [builderNote, generatedIndividualPrompt]);

  const previewGroupPrompt = useMemo(() => {
    const note = normalizeText(builderNote);
    return note ? `${generatedGroupPrompt}

Дополнительное наблюдение специалиста:
${note}` : generatedGroupPrompt;
  }, [builderNote, generatedGroupPrompt]);
  const createRule = () => {
    const item: MethodRule = {
      id: uid("rule"),
      title: "Новое правило",
      tests: "",
      condition: "",
      interpretation: "",
      clientText: "",
      specialistText: "",
      priority: 50,
      active: true,
      verified: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setStore((prev) => ({ ...prev, rules: [item, ...prev.rules] }));
    setSelectedRuleId(item.id);
    setTab("rules");
  };

  const createCombination = () => {
    const item: Combination = {
      id: uid("combo"),
      title: "Новое сочетание",
      tests: "",
      pattern: "",
      hypothesis: "",
      risks: "",
      recommendations: "",
      clientText: "",
      specialistText: "",
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setStore((prev) => ({ ...prev, combinations: [item, ...prev.combinations] }));
    setSelectedCombinationId(item.id);
    setTab("combinations");
  };

  const createTemplate = (type: PromptTemplate["type"] = "individual") => {
    const item: PromptTemplate = {
      id: uid("tpl"),
      title: type === "individual" ? "Новый шаблон для портрета" : "Новый шаблон для группы",
      type,
      content: "",
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setStore((prev) => ({ ...prev, templates: [item, ...prev.templates] }));
    setSelectedTemplateId(item.id);
    if (type === "individual") setIndividualTemplateId(item.id);
    if (type === "group") setGroupTemplateId(item.id);
    setTab("templates");
  };

  const createRuleFromCapture = () => {
    const text = normalizeText(captureText);
    if (!text) return;
    const title = normalizeText(captureTitle) || "Черновик из опыта";
    const tests = normalizeText(captureTests);
    const item: MethodRule = {
      id: uid("rule"),
      title,
      tests,
      condition: `Используй это правило, когда в результатах проявляется следующий паттерн: ${text}`,
      interpretation: text,
      clientText: "Сформулируй мягкую клиентскую версию после проверки на конкретных результатах.",
      specialistText: "Уточни границы применимости и риски ложных выводов.",
      priority: 55,
      active: true,
      verified: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const note: CaptureNote = {
      id: uid("note"),
      title,
      text,
      linkedTests: tests,
      active: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setStore((prev) => ({ ...prev, rules: [item, ...prev.rules], notes: [note, ...prev.notes] }));
    setCaptureTitle("");
    setCaptureTests("");
    setCaptureText("");
    setSelectedRuleId(item.id);
    setTab("rules");
  };

  const updateRule = (patch: Partial<MethodRule>) => {
    if (!selectedRule) return;
    setStore((prev) => ({
      ...prev,
      rules: prev.rules.map((item) => (item.id === selectedRule.id ? { ...item, ...patch, updatedAt: nowIso() } : item)),
    }));
  };

  const updateCombination = (patch: Partial<Combination>) => {
    if (!selectedCombination) return;
    setStore((prev) => ({
      ...prev,
      combinations: prev.combinations.map((item) => (item.id === selectedCombination.id ? { ...item, ...patch, updatedAt: nowIso() } : item)),
    }));
  };

  const updateTemplate = (patch: Partial<PromptTemplate>) => {
    if (!selectedTemplate) return;
    setStore((prev) => ({
      ...prev,
      templates: prev.templates.map((item) => (item.id === selectedTemplate.id ? { ...item, ...patch, updatedAt: nowIso() } : item)),
    }));
  };

  const removeSelectedRule = () => {
    if (!selectedRule) return;
    const next = store.rules.filter((item) => item.id !== selectedRule.id);
    setStore((prev) => ({ ...prev, rules: next }));
    setSelectedRuleId(next[0]?.id || "");
  };

  const removeSelectedCombination = () => {
    if (!selectedCombination) return;
    const next = store.combinations.filter((item) => item.id !== selectedCombination.id);
    setStore((prev) => ({ ...prev, combinations: next }));
    setSelectedCombinationId(next[0]?.id || "");
  };

  const removeSelectedTemplate = () => {
    if (!selectedTemplate) return;
    const next = store.templates.filter((item) => item.id !== selectedTemplate.id);
    setStore((prev) => ({ ...prev, templates: next }));
    setSelectedTemplateId(next[0]?.id || "");
    if (individualTemplateId === selectedTemplate.id) setIndividualTemplateId(next.find((item) => item.type === "individual")?.id || "");
    if (groupTemplateId === selectedTemplate.id) setGroupTemplateId(next.find((item) => item.type === "group")?.id || "");
  };

  const applyPromptsToRoom = async () => {
    if (!session || !selectedRoomId || !dashboard?.room?.name) return;
    setApplyBusy(true);
    setApplyMsg("");
    try {
      const r = await fetch("/api/training/rooms/update", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        body: JSON.stringify({
          room_id: selectedRoomId,
          name: dashboard.room.name,
          analysis_prompt: previewIndividualPrompt,
          group_analysis_prompt: previewGroupPrompt,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось применить промпты к комнате");
      setApplyMsg("Методическая база применена к AI-аналитике комнаты ✅");
      setDashboard((prev) => (prev ? { ...prev, room: { ...(prev.room as any), analysis_prompt: previewIndividualPrompt, group_analysis_prompt: previewGroupPrompt } } : prev));
    } catch (e: any) {
      setApplyMsg(e?.message || "Ошибка");
    } finally {
      setApplyBusy(false);
    }
  };

  const copyText = async (text: string, okText: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsg(okText);
      setTimeout(() => setCopiedMsg(""), 1800);
    } catch {
      setCopiedMsg("Не удалось скопировать");
      setTimeout(() => setCopiedMsg(""), 1800);
    }
  };

  const importJsonFile = async (file: File) => {
    const raw = await file.text();
    const parsed = safeParseStore(raw);
    setStore(parsed);
    setSelectedRuleId(parsed.rules[0]?.id || "");
    setSelectedCombinationId(parsed.combinations[0]?.id || "");
    setSelectedTemplateId(parsed.templates[0]?.id || "");
    setIndividualTemplateId(parsed.templates.find((t) => t.type === "individual")?.id || "");
    setGroupTemplateId(parsed.templates.find((t) => t.type === "group")?.id || "");
  };

  if (!session || !user) {
    return (
      <Layout title="Методическая база">
        <div className="card text-sm text-zinc-700">
          Войдите, чтобы открыть методическую базу.
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
      <Layout title="Методическая база">
        <div className="card text-sm text-zinc-700">Этот раздел доступен только специалисту.</div>
      </Layout>
    );
  }

  return (
    <Layout title="Методическая база">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
        <Link href="/specialist" className="btn btn-secondary btn-sm">← К кабинету специалиста</Link>
        <Link href={selectedRoomId ? `/specialist/analysis?room_id=${encodeURIComponent(selectedRoomId)}` : "/specialist/analysis"} className="btn btn-secondary btn-sm">AI-аналитика</Link>
        {selectedRoomId ? <Link href={`/specialist/rooms/${encodeURIComponent(selectedRoomId)}`} className="btn btn-secondary btn-sm">Открыть комнату</Link> : null}
      </div>

      <div className="mb-4 card text-sm text-zinc-700">
        Здесь специалист собирает собственную методику: правила, сочетания, наблюдения и шаблоны. Пока это песочница без БД — данные хранятся локально в браузере, чтобы ты мог быстро проверить удобство и логику.
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="grid gap-4 self-start content-start">
          <div className="card">
            <SectionTitle title="Связь с комнатой" note="Можно сразу собирать промт и применять его в AI-аналитику выбранной комнаты." />
            <div className="mt-3 flex items-center gap-2">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (!session) return;
                  setRoomsLoading(true);
                  setRoomsErr("");
                  fetch("/api/training/rooms/my", { headers: { authorization: `Bearer ${session.access_token}` }, cache: "no-store" })
                    .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
                    .then(({ ok, j }) => {
                      if (!ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить комнаты");
                      setRooms(Array.isArray(j.rooms) ? j.rooms : []);
                    })
                    .catch((e) => setRoomsErr(e?.message || "Ошибка"))
                    .finally(() => setRoomsLoading(false));
                }}
                disabled={roomsLoading}
              >
                Обновить
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>Импорт JSON</button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  importJsonFile(file).finally(() => {
                    if (e.currentTarget) e.currentTarget.value = "";
                  });
                }}
              />
            </div>
            {roomsErr ? <div className="mt-3 text-sm text-red-600">{roomsErr}</div> : null}
            {roomErr ? <div className="mt-3 text-sm text-red-600">{roomErr}</div> : null}
            <div className="mt-3 grid gap-2">
              <label className="grid gap-1 text-xs font-medium text-zinc-700">
                Комната
                <select
                  value={selectedRoomId}
                  onChange={(e) => {
                    const nextRoomId = e.target.value;
                    setSelectedRoomId(nextRoomId);
                    router.replace({ pathname: router.pathname, query: nextRoomId ? { room_id: nextRoomId } : {} }, undefined, { shallow: true });
                  }}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm"
                >
                  <option value="">Выбери комнату</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
              </label>
              <div className="rounded-2xl border bg-white/60 px-3 py-3 text-xs text-zinc-600">
                {roomLoading ? "Загрузка комнаты…" : dashboard?.room ? (
                  <>
                    <div className="font-semibold text-zinc-800">{dashboard.room.name}</div>
                    <div className="mt-1">Текущий индивидуальный промпт: {dashboard.room.analysis_prompt ? `${dashboard.room.analysis_prompt.length} симв.` : "пусто"}</div>
                    <div className="mt-1">Текущий групповой промпт: {dashboard.room.group_analysis_prompt ? `${dashboard.room.group_analysis_prompt.length} симв.` : "пусто"}</div>
                  </>
                ) : "Комната не выбрана."}
              </div>
              <button onClick={applyPromptsToRoom} disabled={applyBusy || !selectedRoomId} className="btn btn-primary disabled:opacity-50">
                {applyBusy ? "Применяю…" : "Применить к AI-аналитике комнаты"}
              </button>
              {applyMsg ? <div className="text-sm text-zinc-600">{applyMsg}</div> : null}
            </div>
          </div>

          <div className="card">
            <SectionTitle title="Быстрый захват опыта" note="Сюда можно кидать сырой профессиональный вывод, а потом превращать его в правило и наблюдение." />
            <div className="mt-3 grid gap-2">
              <input value={captureTitle} onChange={(e) => setCaptureTitle(e.target.value)} placeholder="Название наблюдения" className="input" />
              <input value={captureTests} onChange={(e) => setCaptureTests(e.target.value)} placeholder="Какие тесты задействованы" className="input" />
              <textarea value={captureText} onChange={(e) => setCaptureText(e.target.value)} placeholder="Например: если у человека жёсткие полярные стили руководства и низкая эмоциональная регуляция, то в нагрузке он может метаться между контролем и дистанцией..." className="min-h-[180px] rounded-2xl border bg-white px-3 py-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                <button onClick={createRuleFromCapture} disabled={!normalizeText(captureText)} className="btn btn-secondary btn-sm disabled:opacity-50">Преобразовать в правило</button>
                <button onClick={() => setBuilderNote(captureText)} disabled={!normalizeText(captureText)} className="btn btn-secondary btn-sm disabled:opacity-50">Перенести в сборщик промта</button>
              </div>
            </div>
          </div>

          <div className="card">
            <SectionTitle title="Экспорт базы" note="Чтобы не потерять наработки, можно выгружать и переносить между браузерами вручную." />
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => downloadJson("method-base.json", store)}>Скачать JSON</button>
              <button className="btn btn-secondary btn-sm" onClick={() => copyText(JSON.stringify(store, null, 2), "JSON скопирован ✅")}>Копировать JSON</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setStore(defaultStore)}>Сбросить к демо-набору</button>
            </div>
            {copiedMsg ? <div className="mt-2 text-sm text-zinc-600">{copiedMsg}</div> : null}
          </div>
        </div>

        <div className="grid gap-4 self-start content-start">
          <div className="card">
            <div className="flex flex-wrap gap-2">
              {([
                ["rules", "Личные правила"],
                ["combinations", "Сочетания тестов"],
                ["templates", "Шаблоны промтов"],
                ["builder", "Сборщик промта"],
              ] as Array<[TabKey, string]>).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={[
                    "rounded-2xl border px-4 py-2 text-sm transition",
                    tab === key ? "border-zinc-900 bg-white shadow-sm" : "bg-white/60 hover:bg-white",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {tab === "rules" ? (
            <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className="card">
                <div className="flex items-center justify-between gap-2">
                  <SectionTitle title="Правила" note="Интерпретационные правила для ИИ и для тебя." />
                  <button onClick={createRule} className="btn btn-secondary btn-sm">+ Правило</button>
                </div>
                <div className="mt-3 grid max-h-[34rem] gap-2 overflow-y-auto pr-1">
                  {store.rules.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedRuleId(item.id)}
                      className={[
                        "rounded-2xl border px-3 py-3 text-left transition",
                        item.id === selectedRuleId ? "border-zinc-900 bg-white shadow-sm" : "bg-white/60 hover:bg-white",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-zinc-900">{item.title || "Без названия"}</div>
                        <div className="text-[11px] text-zinc-500">P{item.priority}</div>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">{item.tests || "тесты не указаны"}</div>
                      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                        <span className={`rounded-full border px-2 py-0.5 ${item.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-zinc-50 text-zinc-500"}`}>{item.active ? "активно" : "выкл"}</span>
                        <span className={`rounded-full border px-2 py-0.5 ${item.verified ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{item.verified ? "проверено" : "черновик"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="card">
                {selectedRule ? (
                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SectionTitle title="Редактор правила" note="Это ядро твоей методики. Лучше меньше, но точнее." />
                      <button onClick={removeSelectedRule} className="btn btn-secondary btn-sm">Удалить</button>
                    </div>
                    <input value={selectedRule.title} onChange={(e) => updateRule({ title: e.target.value })} className="input" placeholder="Название правила" />
                    <input value={selectedRule.tests} onChange={(e) => updateRule({ tests: e.target.value })} className="input" placeholder="Какие тесты участвуют" />
                    <textarea value={selectedRule.condition} onChange={(e) => updateRule({ condition: e.target.value })} className="min-h-[90px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Условие / сочетание / когда это правило применять" />
                    <textarea value={selectedRule.interpretation} onChange={(e) => updateRule({ interpretation: e.target.value })} className="min-h-[120px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Смысл интерпретации" />
                    <div className="grid gap-3 lg:grid-cols-2">
                      <textarea value={selectedRule.clientText} onChange={(e) => updateRule({ clientText: e.target.value })} className="min-h-[120px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Как это формулировать клиенту" />
                      <textarea value={selectedRule.specialistText} onChange={(e) => updateRule({ specialistText: e.target.value })} className="min-h-[120px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Что оставить только специалисту" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[140px_1fr_1fr] sm:items-center">
                      <label className="grid gap-1 text-xs font-medium text-zinc-700">
                        Приоритет
                        <input type="number" value={selectedRule.priority} onChange={(e) => updateRule({ priority: Number(e.target.value) || 0 })} className="input" />
                      </label>
                      <label className="flex items-center gap-2 text-sm text-zinc-700"><input type="checkbox" checked={selectedRule.active} onChange={(e) => updateRule({ active: e.target.checked })} /> Активно для сборщика</label>
                      <label className="flex items-center gap-2 text-sm text-zinc-700"><input type="checkbox" checked={selectedRule.verified} onChange={(e) => updateRule({ verified: e.target.checked })} /> Правило проверено практикой</label>
                    </div>
                  </div>
                ) : <div className="text-sm text-zinc-500">Выбери правило или создай новое.</div>}
              </div>
            </div>
          ) : null}

          {tab === "combinations" ? (
            <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className="card">
                <div className="flex items-center justify-between gap-2">
                  <SectionTitle title="Сочетания" note="Самое вкусное место: связки между тестами и шкалами." />
                  <button onClick={createCombination} className="btn btn-secondary btn-sm">+ Сочетание</button>
                </div>
                <div className="mt-3 grid max-h-[34rem] gap-2 overflow-y-auto pr-1">
                  {store.combinations.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedCombinationId(item.id)}
                      className={[
                        "rounded-2xl border px-3 py-3 text-left transition",
                        item.id === selectedCombinationId ? "border-zinc-900 bg-white shadow-sm" : "bg-white/60 hover:bg-white",
                      ].join(" ")}
                    >
                      <div className="font-medium text-zinc-900">{item.title || "Без названия"}</div>
                      <div className="mt-1 text-xs text-zinc-500">{item.tests || "тесты не указаны"}</div>
                      <div className="mt-2 text-[11px] text-zinc-500">{item.active ? "активно" : "выключено"}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="card">
                {selectedCombination ? (
                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SectionTitle title="Редактор сочетания" note="Здесь ты кодируешь то, что обычно держится только в голове у специалиста." />
                      <button onClick={removeSelectedCombination} className="btn btn-secondary btn-sm">Удалить</button>
                    </div>
                    <input value={selectedCombination.title} onChange={(e) => updateCombination({ title: e.target.value })} className="input" placeholder="Название сочетания" />
                    <input value={selectedCombination.tests} onChange={(e) => updateCombination({ tests: e.target.value })} className="input" placeholder="Какие тесты участвуют" />
                    <textarea value={selectedCombination.pattern} onChange={(e) => updateCombination({ pattern: e.target.value })} className="min-h-[90px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Что именно считается паттерном" />
                    <textarea value={selectedCombination.hypothesis} onChange={(e) => updateCombination({ hypothesis: e.target.value })} className="min-h-[100px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Гипотеза и смысл сочетания" />
                    <div className="grid gap-3 lg:grid-cols-2">
                      <textarea value={selectedCombination.risks} onChange={(e) => updateCombination({ risks: e.target.value })} className="min-h-[110px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Риски" />
                      <textarea value={selectedCombination.recommendations} onChange={(e) => updateCombination({ recommendations: e.target.value })} className="min-h-[110px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Рекомендации" />
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <textarea value={selectedCombination.clientText} onChange={(e) => updateCombination({ clientText: e.target.value })} className="min-h-[110px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Клиентская формулировка" />
                      <textarea value={selectedCombination.specialistText} onChange={(e) => updateCombination({ specialistText: e.target.value })} className="min-h-[110px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Служебная формулировка для специалиста" />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-zinc-700"><input type="checkbox" checked={selectedCombination.active} onChange={(e) => updateCombination({ active: e.target.checked })} /> Использовать это сочетание в сборщике промта</label>
                  </div>
                ) : <div className="text-sm text-zinc-500">Выбери сочетание или создай новое.</div>}
              </div>
            </div>
          ) : null}

          {tab === "templates" ? (
            <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
              <div className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SectionTitle title="Шаблоны" note="Это уже не правила, а общий тон и структура ответа ИИ." />
                  <div className="flex gap-2">
                    <button onClick={() => createTemplate("individual")} className="btn btn-secondary btn-sm">+ Портрет</button>
                    <button onClick={() => createTemplate("group")} className="btn btn-secondary btn-sm">+ Группа</button>
                  </div>
                </div>
                <div className="mt-3 grid max-h-[34rem] gap-2 overflow-y-auto pr-1">
                  {store.templates.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedTemplateId(item.id)}
                      className={[
                        "rounded-2xl border px-3 py-3 text-left transition",
                        item.id === selectedTemplateId ? "border-zinc-900 bg-white shadow-sm" : "bg-white/60 hover:bg-white",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-zinc-900">{item.title || "Без названия"}</div>
                        <div className="text-[11px] text-zinc-500">{item.type === "individual" ? "портрет" : "группа"}</div>
                      </div>
                      <div className="mt-2 text-[11px] text-zinc-500">{item.active ? "активно" : "выключено"}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="card">
                {selectedTemplate ? (
                  <div className="grid gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <SectionTitle title="Редактор шаблона" note="Храни здесь стиль, глубину и архитектуру ответа, а не конкретные паттерны." />
                      <button onClick={removeSelectedTemplate} className="btn btn-secondary btn-sm">Удалить</button>
                    </div>
                    <input value={selectedTemplate.title} onChange={(e) => updateTemplate({ title: e.target.value })} className="input" placeholder="Название шаблона" />
                    <label className="grid gap-1 text-xs font-medium text-zinc-700">
                      Тип
                      <select value={selectedTemplate.type} onChange={(e) => updateTemplate({ type: e.target.value as PromptTemplate["type"] })} className="rounded-2xl border bg-white px-3 py-2 text-sm">
                        <option value="individual">Индивидуальный</option>
                        <option value="group">Групповой</option>
                      </select>
                    </label>
                    <textarea value={selectedTemplate.content} onChange={(e) => updateTemplate({ content: e.target.value })} className="min-h-[220px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Например: сначала опиши ядро профиля, затем противоречия, затем рекомендации. Не используй академический тон. Пиши как опытный специалист, а не как канцелярская машина." />
                    <label className="flex items-center gap-2 text-sm text-zinc-700"><input type="checkbox" checked={selectedTemplate.active} onChange={(e) => updateTemplate({ active: e.target.checked })} /> Активно</label>
                  </div>
                ) : <div className="text-sm text-zinc-500">Выбери шаблон или создай новый.</div>}
              </div>
            </div>
          ) : null}

          {tab === "builder" ? (
            <div className="grid gap-4">
              <div className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <SectionTitle title="Сборщик промта" note="Здесь методическая база превращается в рабочий промт для AI-аналитики." />
                  <div className="flex flex-wrap gap-2">
                    <button className="btn btn-secondary btn-sm" onClick={() => copyText(previewIndividualPrompt, "Индивидуальный промт скопирован ✅")}>Копировать портрет</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => copyText(previewGroupPrompt, "Групповой промт скопирован ✅")}>Копировать группу</button>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <label className="grid gap-1 text-xs font-medium text-zinc-700">
                    Шаблон для полного портрета
                    <select value={individualTemplateId} onChange={(e) => setIndividualTemplateId(e.target.value)} className="rounded-2xl border bg-white px-3 py-2 text-sm">
                      <option value="">Без шаблона</option>
                      {store.templates.filter((item) => item.type === "individual").map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-zinc-700">
                    Шаблон для группового анализа
                    <select value={groupTemplateId} onChange={(e) => setGroupTemplateId(e.target.value)} className="rounded-2xl border bg-white px-3 py-2 text-sm">
                      <option value="">Без шаблона</option>
                      {store.templates.filter((item) => item.type === "group").map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <textarea value={builderIndividualIntro} onChange={(e) => setBuilderIndividualIntro(e.target.value)} className="min-h-[110px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Дополнительная рамка для индивидуального портрета: на что делать акцент именно сейчас." />
                  <textarea value={builderGroupIntro} onChange={(e) => setBuilderGroupIntro(e.target.value)} className="min-h-[110px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Дополнительная рамка для группового анализа: подбор, лидерство, конфликтность, обучение и т.д." />
                </div>
                <textarea value={builderNote} onChange={(e) => setBuilderNote(e.target.value)} className="mt-4 min-h-[100px] rounded-2xl border bg-white px-3 py-2 text-sm" placeholder="Сюда можно временно подбросить живое наблюдение специалиста перед сборкой промта." />
                <div className="mt-2 text-xs text-zinc-500">Активные элементы: правил — {activeRules.length}, сочетаний — {activeCombinations.length}, шаблонов — {activeTemplates.length}, наблюдений — {activeNotes.length}.</div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="card">
                  <SectionTitle title="Индивидуальный промт" note={`Длина: ${generatedIndividualPrompt.length} симв.`} />
                  <textarea value={previewIndividualPrompt} readOnly className="mt-3 min-h-[28rem] w-full rounded-2xl border bg-white px-3 py-2 text-sm" />
                </div>
                <div className="card">
                  <SectionTitle title="Групповой промт" note={`Длина: ${generatedGroupPrompt.length} симв.`} />
                  <textarea value={previewGroupPrompt} readOnly className="mt-3 min-h-[28rem] w-full rounded-2xl border bg-white px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}
