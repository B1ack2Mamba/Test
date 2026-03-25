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
  participants_can_see_digits?: boolean;
};

type Member = {
  id: string;
  user_id: string;
  display_name: string;
  role: "participant" | "specialist";
  joined_at?: string;
  last_seen?: string | null;
  online?: boolean;
};

type Progress = {
  room_id: string;
  user_id: string;
  test_slug: string;
  started_at: string | null;
  completed_at: string | null;
  attempt_id: string | null;
};

type DashboardPayload = {
  room?: { id: string; name: string; analysis_prompt?: string; group_analysis_prompt?: string };
  members?: Member[];
  progress?: Progress[];
};

const SLUG_TITLES: Record<string, string> = {
  "color-types": "Цветотипы",
  "16pf-a": "16PF-A",
  emin: "Эмоциональный интеллект (ЭМИН)",
  "time-management": "Тайм-менеджмент",
  "learning-typology": "Типология личности обучения",
};

function titleForSlug(slug: string) {
  return SLUG_TITLES[slug] || slug;
}

export default function SpecialistAnalysisPage() {
  const { session, user } = useSession();
  const router = useRouter();
  const roomIdFromQuery = typeof router.query.room_id === "string" ? router.query.room_id : "";

  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsErr, setRoomsErr] = useState("");

  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const [dashErr, setDashErr] = useState("");

  const [selectedUserId, setSelectedUserId] = useState("");

  const [promptDraft, setPromptDraft] = useState("");
  const [groupPromptDraft, setGroupPromptDraft] = useState("");
  const [savingIndividualPrompt, setSavingIndividualPrompt] = useState(false);
  const [savingGroupPrompt, setSavingGroupPrompt] = useState(false);
  const [promptMsg, setPromptMsg] = useState("");
  const [groupPromptMsg, setGroupPromptMsg] = useState("");

  const [portrait, setPortrait] = useState("");
  const [portraitMsg, setPortraitMsg] = useState("");
  const [portraitBusy, setPortraitBusy] = useState(false);

  const [groupAnalysis, setGroupAnalysis] = useState("");
  const [groupAnalysisMsg, setGroupAnalysisMsg] = useState("");
  const [groupAnalysisBusy, setGroupAnalysisBusy] = useState(false);

  const roomsReqRef = useRef(0);
  const dashboardReqRef = useRef(0);
  const portraitReqRef = useRef(0);
  const portraitLockRef = useRef(false);
  const portraitAbortRef = useRef<AbortController | null>(null);
  const portraitMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groupReqRef = useRef(0);
  const groupLockRef = useRef(false);
  const groupAbortRef = useRef<AbortController | null>(null);
  const groupMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!roomIdFromQuery) return;
    setSelectedRoomId(roomIdFromQuery);
  }, [roomIdFromQuery]);

  useEffect(() => {
    return () => {
      portraitAbortRef.current?.abort();
      groupAbortRef.current?.abort();
      if (portraitMsgTimerRef.current) clearTimeout(portraitMsgTimerRef.current);
      if (groupMsgTimerRef.current) clearTimeout(groupMsgTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const loadRooms = async () => {
      const reqId = ++roomsReqRef.current;
      setRoomsLoading(true);
      setRoomsErr("");
      try {
        const r = await fetch("/api/training/rooms/my", {
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить комнаты");
        if (cancelled || reqId !== roomsReqRef.current) return;
        const nextRooms = (j.rooms || []) as Room[];
        setRooms(nextRooms);
        if (!selectedRoomId && !roomIdFromQuery && nextRooms.length) {
          setSelectedRoomId(nextRooms[0].id);
        }
      } catch (e: any) {
        if (!cancelled && reqId === roomsReqRef.current) setRoomsErr(e?.message || "Ошибка");
      } finally {
        if (!cancelled && reqId === roomsReqRef.current) setRoomsLoading(false);
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
      const reqId = ++dashboardReqRef.current;
      setDashLoading(true);
      setDashErr("");
      setPortrait("");
      setPortraitMsg("");
      setGroupAnalysis("");
      setGroupAnalysisMsg("");
      try {
        const r = await fetch(`/api/training/rooms/dashboard?room_id=${encodeURIComponent(selectedRoomId)}`, {
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить аналитику комнаты");
        if (cancelled || reqId !== dashboardReqRef.current) return;
        setDashboard(j);
        const individualPrompt = typeof j?.room?.analysis_prompt === "string" ? String(j.room.analysis_prompt) : "";
        const collectivePrompt = typeof j?.room?.group_analysis_prompt === "string" ? String(j.room.group_analysis_prompt) : "";
        setPromptDraft(individualPrompt);
        setGroupPromptDraft(collectivePrompt);
        const participants = ((j.members || []) as Member[]).filter((m) => m.role === "participant");
        setSelectedUserId((prev) => {
          if (prev && participants.some((m) => m.user_id === prev)) return prev;
          return participants[0]?.user_id || "";
        });
      } catch (e: any) {
        if (!cancelled && reqId === dashboardReqRef.current) {
          setDashboard(null);
          setDashErr(e?.message || "Ошибка");
        }
      } finally {
        if (!cancelled && reqId === dashboardReqRef.current) setDashLoading(false);
      }
    };
    loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [session?.access_token, selectedRoomId]);

  useEffect(() => {
    portraitAbortRef.current?.abort();
    portraitLockRef.current = false;
    setPortraitBusy(false);
  }, [selectedRoomId, selectedUserId]);

  useEffect(() => {
    groupAbortRef.current?.abort();
    groupLockRef.current = false;
    setGroupAnalysisBusy(false);
  }, [selectedRoomId]);

  const participants = useMemo(
    () => ((dashboard?.members || []) as Member[]).filter((m) => m.role === "participant"),
    [dashboard?.members]
  );

  const completedByUser = useMemo(() => {
    const map = new Map<string, Progress[]>();
    for (const row of (dashboard?.progress || []) as Progress[]) {
      if (!row?.completed_at || !row?.attempt_id) continue;
      const list = map.get(row.user_id) || [];
      list.push(row);
      map.set(row.user_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const ta = a.completed_at ? new Date(a.completed_at).getTime() : 0;
        const tb = b.completed_at ? new Date(b.completed_at).getTime() : 0;
        return tb - ta;
      });
    }
    return map;
  }, [dashboard?.progress]);

  const selectedMember = participants.find((m) => m.user_id === selectedUserId) || null;
  const selectedAttempts = selectedUserId ? completedByUser.get(selectedUserId) || [] : [];
  const anchorAttemptId = selectedAttempts[0]?.attempt_id || "";
  const participantsWithCompletedTests = useMemo(
    () => participants.filter((member) => (completedByUser.get(member.user_id) || []).length > 0),
    [participants, completedByUser]
  );

  const saveRoomPrompts = async (mode: "individual" | "group") => {
    if (!session || !selectedRoomId || !dashboard?.room?.name) return;
    if (mode === "individual") {
      setSavingIndividualPrompt(true);
      setPromptMsg("");
    } else {
      setSavingGroupPrompt(true);
      setGroupPromptMsg("");
    }
    try {
      const r = await fetch("/api/training/rooms/update", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
        body: JSON.stringify({
          room_id: selectedRoomId,
          name: dashboard.room.name,
          analysis_prompt: promptDraft.replace(/\r\n/g, "\n"),
          group_analysis_prompt: groupPromptDraft.replace(/\r\n/g, "\n"),
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось сохранить промпт");
      setDashboard((prev) => prev ? {
        ...prev,
        room: {
          ...(prev.room as any),
          analysis_prompt: promptDraft.replace(/\r\n/g, "\n"),
          group_analysis_prompt: groupPromptDraft.replace(/\r\n/g, "\n"),
        },
      } : prev);
      if (mode === "individual") {
        setPromptMsg("Промпт портрета сохранён ✅");
        setTimeout(() => setPromptMsg(""), 2500);
      } else {
        setGroupPromptMsg("Промпт группы сохранён ✅");
        setTimeout(() => setGroupPromptMsg(""), 2500);
      }
    } catch (e: any) {
      if (mode === "individual") setPromptMsg(e?.message || "Ошибка");
      else setGroupPromptMsg(e?.message || "Ошибка");
    } finally {
      if (mode === "individual") setSavingIndividualPrompt(false);
      else setSavingGroupPrompt(false);
    }
  };

  const generatePortrait = async (force = false) => {
    if (!session || !anchorAttemptId) return;
    if (portraitLockRef.current) {
      setPortraitMsg("Портрет уже собирается…");
      if (portraitMsgTimerRef.current) clearTimeout(portraitMsgTimerRef.current);
      portraitMsgTimerRef.current = setTimeout(() => setPortraitMsg(""), 1800);
      return;
    }
    portraitLockRef.current = true;
    portraitAbortRef.current?.abort();
    const controller = new AbortController();
    portraitAbortRef.current = controller;
    const reqId = ++portraitReqRef.current;
    setPortraitBusy(true);
    setPortraitMsg("");
    try {
      const r = await fetch("/api/training/rooms/full-portrait", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ attempt_id: anchorAttemptId, force }),
        cache: "no-store",
        signal: controller.signal,
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось собрать портрет");
      if (reqId !== portraitReqRef.current) return;
      setPortrait(String(j.text || ""));
      setPortraitMsg(j.cached && !force ? "Открыт сохранённый портрет ✅" : "Портрет собран ✅");
      if (portraitMsgTimerRef.current) clearTimeout(portraitMsgTimerRef.current);
      portraitMsgTimerRef.current = setTimeout(() => setPortraitMsg(""), 2500);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      if (reqId !== portraitReqRef.current) return;
      setPortraitMsg(e?.message || "Ошибка");
    } finally {
      if (reqId === portraitReqRef.current) {
        portraitLockRef.current = false;
        portraitAbortRef.current = null;
        setPortraitBusy(false);
      }
    }
  };

  const generateGroupAnalysis = async () => {
    if (!session || !selectedRoomId) return;
    if (groupLockRef.current) {
      setGroupAnalysisMsg("Групповой анализ уже собирается…");
      if (groupMsgTimerRef.current) clearTimeout(groupMsgTimerRef.current);
      groupMsgTimerRef.current = setTimeout(() => setGroupAnalysisMsg(""), 1800);
      return;
    }
    groupLockRef.current = true;
    groupAbortRef.current?.abort();
    const controller = new AbortController();
    groupAbortRef.current = controller;
    const reqId = ++groupReqRef.current;
    setGroupAnalysisBusy(true);
    setGroupAnalysisMsg("");
    try {
      const r = await fetch("/api/training/rooms/group-analysis", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: selectedRoomId }),
        cache: "no-store",
        signal: controller.signal,
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось собрать групповой анализ");
      if (reqId !== groupReqRef.current) return;
      setGroupAnalysis(String(j.text || ""));
      setGroupAnalysisMsg(`Групповой анализ собран ✅${Number(j?.participant_count || 0) > 0 ? ` · участников: ${j.participant_count}` : ""}`);
      if (groupMsgTimerRef.current) clearTimeout(groupMsgTimerRef.current);
      groupMsgTimerRef.current = setTimeout(() => setGroupAnalysisMsg(""), 2500);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      if (reqId !== groupReqRef.current) return;
      setGroupAnalysisMsg(e?.message || "Ошибка");
    } finally {
      if (reqId === groupReqRef.current) {
        groupLockRef.current = false;
        groupAbortRef.current = null;
        setGroupAnalysisBusy(false);
      }
    }
  };

  const copyText = async (text: string, okMessage: string, setMessage: (value: string) => void) => {
    const value = text.trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setMessage(okMessage);
      setTimeout(() => setMessage(""), 2500);
    } catch {
      setMessage("Не удалось скопировать");
    }
  };

  if (!session || !user) {
    return (
      <Layout title="Аналитика клиента">
        <div className="card text-sm text-zinc-700">
          Войдите, чтобы открыть раздел аналитики.
          <div className="mt-3">
            <Link href="/auth?next=%2Fspecialist%2Fanalysis" className="btn btn-secondary btn-sm">
              Вход / регистрация
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isSpecialistUser(user)) {
    return (
      <Layout title="Аналитика клиента">
        <div className="card text-sm text-zinc-700">Этот раздел доступен только специалисту.</div>
      </Layout>
    );
  }

  return (
    <Layout title="AI-аналитика клиента">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
        <Link href="/specialist" className="btn btn-secondary btn-sm">← К кабинету специалиста</Link>
        {selectedRoomId ? <Link href={`/specialist/rooms/${encodeURIComponent(selectedRoomId)}`} className="btn btn-secondary btn-sm">Открыть комнату</Link> : null}
      </div>

      <div className="mb-4 card text-sm text-zinc-700">
        Здесь живут две тяжёлые штуки: полный AI-портрет отдельного клиента и групповой анализ комнаты. Комната остаётся чище, а мясо вынесено сюда.
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="grid gap-4 self-start content-start">
          <div className="card">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">Комнаты</div>
              <button
                onClick={() => {
                  if (!session) return;
                  setRoomsLoading(true);
                  setRoomsErr("");
                  fetch("/api/training/rooms/my", { headers: { authorization: `Bearer ${session.access_token}` } })
                    .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
                    .then(({ ok, j }) => {
                      if (!ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить комнаты");
                      setRooms(j.rooms || []);
                    })
                    .catch((e) => setRoomsErr(e?.message || "Ошибка"))
                    .finally(() => setRoomsLoading(false));
                }}
                disabled={roomsLoading}
                className="btn btn-secondary btn-sm"
              >
                Обновить
              </button>
            </div>
            {roomsErr ? <div className="mt-3 text-sm text-red-600">{roomsErr}</div> : null}
            <div className="mt-3 grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
              {rooms.map((room) => {
                const active = room.id === selectedRoomId;
                return (
                  <button
                    key={room.id}
                    onClick={() => {
                      setSelectedRoomId(room.id);
                      router.replace({ pathname: router.pathname, query: { room_id: room.id } }, undefined, { shallow: true });
                    }}
                    className={[
                      "rounded-2xl border px-3 py-3 text-left transition",
                      active ? "border-zinc-900 bg-white shadow-sm" : "bg-white/60 hover:bg-white",
                    ].join(" ")}
                  >
                    <div className="font-medium text-zinc-900">{room.name}</div>
                    <div className="mt-1 text-xs text-zinc-500">{new Date(room.created_at).toLocaleString()}</div>
                  </button>
                );
              })}
              {!rooms.length && !roomsLoading ? <div className="text-sm text-zinc-500">Комнат пока нет.</div> : null}
            </div>
          </div>

          <div className="card">
            <div className="text-sm font-semibold">Клиенты комнаты</div>
            {dashErr ? <div className="mt-3 text-sm text-red-600">{dashErr}</div> : null}
            {dashLoading ? <div className="mt-3 text-sm text-zinc-500">Загрузка…</div> : null}
            <div className="mt-3 grid max-h-[70vh] gap-2 overflow-y-auto pr-1">
              {participants.map((member) => {
                const done = completedByUser.get(member.user_id) || [];
                const active = member.user_id === selectedUserId;
                return (
                  <button
                    key={member.id}
                    onClick={() => {
                      setSelectedUserId(member.user_id);
                      setPortrait("");
                      setPortraitMsg("");
                    }}
                    className={[
                      "rounded-2xl border px-3 py-3 text-left transition",
                      active ? "border-zinc-900 bg-white shadow-sm" : "bg-white/60 hover:bg-white",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium text-zinc-900">{member.display_name || "Участник"}</div>
                      <div className="text-xs text-zinc-500">{done.length} тест.</div>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">{member.online ? "онлайн" : member.last_seen ? `последняя активность ${new Date(member.last_seen).toLocaleString()}` : "ещё не заходил"}</div>
                  </button>
                );
              })}
              {!participants.length && !dashLoading ? <div className="text-sm text-zinc-500">В комнате пока нет участников.</div> : null}
            </div>
          </div>
        </div>

        <div className="grid gap-4 self-start content-start">
          <div className="card">
            <div className="text-lg font-semibold">{dashboard?.room?.name || "Выбери комнату"}</div>
            <div className="mt-1 text-sm text-zinc-500">Ниже два отдельных окна промтов: одно для личных портретов, второе для групповой аналитики.</div>
          </div>

          <div className="card">
            <div className="text-lg font-semibold">Промпт для полного портрета клиента</div>
            <div className="mt-1 text-sm text-zinc-500">Применяется ко всем индивидуальным портретам клиентов в этой комнате.</div>
            <textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              className="mt-3 min-h-[180px] w-full rounded-2xl border bg-white px-3 py-2 text-sm"
              placeholder="Например: делай акцент на рисках, стиле обучения, противоречиях профиля и практических рекомендациях для сопровождения клиента."
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => saveRoomPrompts("individual")} disabled={savingIndividualPrompt || !selectedRoomId} className="btn btn-primary btn-sm disabled:opacity-50">
                {savingIndividualPrompt ? "…" : "Сохранить промпт портрета"}
              </button>
              {promptMsg ? <div className="text-xs text-zinc-600">{promptMsg}</div> : null}
            </div>
          </div>

          <div className="card">
            <div className="text-lg font-semibold">Промпт для группового анализа</div>
            <div className="mt-1 text-sm text-zinc-500">Применяется к общему анализу всех участников комнаты, у которых есть завершённые тесты.</div>
            <textarea
              value={groupPromptDraft}
              onChange={(e) => setGroupPromptDraft(e.target.value)}
              className="mt-3 min-h-[180px] w-full rounded-2xl border bg-white px-3 py-2 text-sm"
              placeholder="Например: ищи кластеры внутри группы, зоны потенциального конфликта, темп группы, уровень саморегуляции и рекомендации ведущему по удержанию включённости."
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => saveRoomPrompts("group")} disabled={savingGroupPrompt || !selectedRoomId} className="btn btn-primary btn-sm disabled:opacity-50">
                {savingGroupPrompt ? "…" : "Сохранить промпт группы"}
              </button>
              {groupPromptMsg ? <div className="text-xs text-zinc-600">{groupPromptMsg}</div> : null}
            </div>
          </div>

          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{selectedMember ? `Полный портрет: ${selectedMember.display_name}` : "Выбери клиента"}</div>
                <div className="mt-1 text-sm text-zinc-500">Берутся все завершённые тесты клиента в текущей комнате. Якорем служит последняя завершённая попытка.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => copyText(portrait, "Портрет скопирован ✅", setPortraitMsg)} disabled={!portrait.trim()} className="btn btn-secondary btn-sm disabled:opacity-50">Копировать</button>
                <button onClick={() => generatePortrait(false)} disabled={portraitBusy || !anchorAttemptId} className="btn btn-primary btn-sm disabled:opacity-50">
                  {portraitBusy ? "…" : portrait ? "Открыть / обновить" : "Собрать портрет"}
                </button>
                <button onClick={() => generatePortrait(true)} disabled={portraitBusy || !anchorAttemptId} className="btn btn-secondary btn-sm disabled:opacity-50">Пересчитать</button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border bg-white/50 p-3">
              <div className="text-sm font-medium">Завершённые тесты клиента</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedAttempts.map((row) => (
                  <span key={row.attempt_id || `${row.user_id}:${row.test_slug}`} className="rounded-full border bg-white px-2 py-1 text-xs text-zinc-700">
                    {titleForSlug(row.test_slug)}
                  </span>
                ))}
                {!selectedAttempts.length ? <span className="text-sm text-zinc-500">Нет завершённых тестов.</span> : null}
              </div>
            </div>

            <div className="mt-4 min-h-[320px] rounded-2xl border bg-white p-4 text-sm whitespace-pre-wrap">
              {portrait || <span className="text-zinc-500">Пока пусто. Выбери клиента и нажми «Собрать портрет».</span>}
            </div>
            {portraitMsg ? <div className="mt-2 text-xs text-zinc-600">{portraitMsg}</div> : null}
          </div>

          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Групповой анализ комнаты</div>
                <div className="mt-1 text-sm text-zinc-500">Берутся все участники текущей комнаты, у которых есть хотя бы один завершённый тест.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => copyText(groupAnalysis, "Групповой анализ скопирован ✅", setGroupAnalysisMsg)} disabled={!groupAnalysis.trim()} className="btn btn-secondary btn-sm disabled:opacity-50">Копировать</button>
                <button onClick={generateGroupAnalysis} disabled={groupAnalysisBusy || !selectedRoomId || !participantsWithCompletedTests.length} className="btn btn-primary btn-sm disabled:opacity-50">
                  {groupAnalysisBusy ? "…" : groupAnalysis ? "Пересобрать группу" : "Собрать группу"}
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border bg-white/50 p-3">
              <div className="text-sm font-medium">Кто войдёт в анализ</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {participantsWithCompletedTests.map((member) => (
                  <span key={member.id} className="rounded-full border bg-white px-2 py-1 text-xs text-zinc-700">
                    {member.display_name || "Участник"} · {(completedByUser.get(member.user_id) || []).length} тест.
                  </span>
                ))}
                {!participantsWithCompletedTests.length ? <span className="text-sm text-zinc-500">Пока нет участников с завершёнными тестами.</span> : null}
              </div>
            </div>

            <div className="mt-4 min-h-[320px] rounded-2xl border bg-white p-4 text-sm whitespace-pre-wrap">
              {groupAnalysis || <span className="text-zinc-500">Пока пусто. Нажми «Собрать группу», чтобы получить общий анализ по комнате.</span>}
            </div>
            {groupAnalysisMsg ? <div className="mt-2 text-xs text-zinc-600">{groupAnalysisMsg}</div> : null}
          </div>
        </div>
      </div>
    </Layout>
  );
}
