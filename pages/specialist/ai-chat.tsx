import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";
import { isSpecialistUser } from "@/lib/specialist";

type Provider = "openai" | "deepseek";
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  provider?: Provider;
  model?: string;
  durationMs?: number;
  pending?: boolean;
  taskId?: string;
};
type ChatSummary = {
  id: string;
  provider: Provider;
  title: string;
  last_provider?: Provider | null;
  last_model?: string | null;
  last_user_message?: string;
  created_at: string;
  updated_at: string;
};
type StoredChatMessage = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  provider?: Provider | null;
  model?: string | null;
  task_id?: string | null;
  status?: string;
  duration_ms?: number | null;
};

type AiTask = {
  id: string;
  chat_id?: string | null;
  assistant_message_id?: string | null;
  provider: Provider;
  model: string;
  response_id?: string | null;
  status: string;
  request_messages?: Array<{ role: "user" | "assistant"; content: string }>;
  result_text?: string;
  error_text?: string;
  started_at: string;
  finished_at?: string | null;
  created_at: string;
  updated_at: string;
};
type PendingFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  data: string;
  preview?: string;
  textChars?: number;
  truncated?: boolean;
  previewLoading?: boolean;
  previewError?: string;
};
type ChatProviderFilter = Provider | "all";
type ChatContextAttempt = {
  id: string;
  test_slug: string;
  test_title: string;
  created_at: string;
  summary: string;
  context_text: string;
};
type ChatContextParticipant = {
  user_id: string;
  display_name: string;
  attempts: ChatContextAttempt[];
  context_text: string;
};
type ChatContextRoom = {
  id: string;
  name: string;
  is_active: boolean;
  participants: ChatContextParticipant[];
  context_text: string;
};

const OPENAI_MODELS = [
  { id: "gpt-5.4-mini", label: "OpenAI GPT-5.4 mini" },
  { id: "gpt-5.4", label: "OpenAI GPT-5.4" },
  { id: "gpt-5.5", label: "OpenAI GPT-5.5" },
  { id: "gpt-5.5-pro", label: "OpenAI GPT-5.5 pro" },
];

const DEEPSEEK_MODELS = [
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

export default function SpecialistAiChatPage() {
  const { session, user } = useSession();
  const [provider, setProvider] = useState<Provider>("deepseek");
  const [model, setModel] = useState("deepseek-v4-pro");
  const [temperature, setTemperature] = useState(0.3);
  const [maxOutputTokens, setMaxOutputTokens] = useState(3000);
  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatSearch, setChatSearch] = useState("");
  const [chatProviderFilter, setChatProviderFilter] = useState<ChatProviderFilter>("all");
  const [chatModelFilter, setChatModelFilter] = useState("all");
  const [editingChatId, setEditingChatId] = useState("");
  const [editingChatTitle, setEditingChatTitle] = useState("");
  const [activeChatId, setActiveChatId] = useState("");
  const [chatsLoading, setChatsLoading] = useState(false);
  const [contextRooms, setContextRooms] = useState<ChatContextRoom[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [selectedParticipantId, setSelectedParticipantId] = useState("");
  const [selectedAttemptId, setSelectedAttemptId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [tasks, setTasks] = useState<AiTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modelOptions = useMemo(() => (provider === "openai" ? OPENAI_MODELS : DEEPSEEK_MODELS), [provider]);
  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId) || null, [chats, activeChatId]);
  const lastModelRequest = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === "user");
    return last?.content || activeChat?.last_user_message || "";
  }, [messages, activeChat?.last_user_message]);
  const chatModelOptions = useMemo(() => {
    return Array.from(new Set(chats.map((c) => c.last_model).filter((x): x is string => Boolean(x)))).sort();
  }, [chats]);
  const filteredChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    return chats.filter((chat) => {
      if (chatProviderFilter !== "all" && chat.provider !== chatProviderFilter) return false;
      if (chatModelFilter !== "all" && chat.last_model !== chatModelFilter) return false;
      if (!q) return true;
      return `${chat.title || ""} ${chat.last_user_message || ""} ${chat.last_model || ""}`.toLowerCase().includes(q);
    });
  }, [chats, chatSearch, chatProviderFilter, chatModelFilter]);
  const selectedRoom = useMemo(() => contextRooms.find((room) => room.id === selectedRoomId) || null, [contextRooms, selectedRoomId]);
  const selectedParticipant = useMemo(
    () => selectedRoom?.participants.find((participant) => participant.user_id === selectedParticipantId) || null,
    [selectedRoom, selectedParticipantId]
  );
  const selectedAttempt = useMemo(
    () => selectedParticipant?.attempts.find((attempt) => attempt.id === selectedAttemptId) || null,
    [selectedParticipant, selectedAttemptId]
  );
  const platformContext = selectedAttempt?.context_text || selectedParticipant?.context_text || selectedRoom?.context_text || "";

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    bootstrapChats();
    loadContext();
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  useEffect(() => {
    setSelectedParticipantId("");
    setSelectedAttemptId("");
  }, [selectedRoomId]);

  useEffect(() => {
    setSelectedAttemptId("");
  }, [selectedParticipantId]);

  const activeTask =
    tasks.find((t) => t.provider === "openai" && (t.status === "queued" || t.status === "in_progress") && (!activeChatId || t.chat_id === activeChatId)) ||
    null;

  useEffect(() => {
    if (!session || !activeTask || pollTimerRef.current) return;
    const started = Date.parse(activeTask.started_at || activeTask.created_at || "") || Date.now();
    setBusy(true);
    setStartedAt(started);
    setElapsedMs(Date.now() - started);
    const ticker = window.setInterval(() => setElapsedMs(Date.now() - started), 1000);
    ensureTaskMessage(activeTask);
    pollOpenAI(activeTask.id, activeTask.id, started, ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, activeTask?.id]);

  const mapStoredMessage = (m: StoredChatMessage): ChatMessage => ({
    id: m.id,
    role: m.role,
    content: m.content,
    provider: m.provider || undefined,
    model: m.model || undefined,
    taskId: m.task_id || undefined,
    pending: m.status === "queued" || m.status === "in_progress",
    durationMs: m.duration_ms || undefined,
  });

  const bootstrapChats = async () => {
    const loaded = await loadChats();
    if (loaded.length && !activeChatId) {
      await loadChat(loaded[0].id);
    }
  };

  const loadChats = async (providerOverride?: ChatProviderFilter): Promise<ChatSummary[]> => {
    if (!session) return [];
    const providerForLoad = providerOverride || "all";
    setChatsLoading(true);
    try {
      const r = await fetch(`/api/specialist/ai-chat-chats?provider=${encodeURIComponent(providerForLoad)}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить чаты");
      const loaded = j.chats || [];
      setChats(loaded);
      return loaded;
    } catch (e: any) {
      setErr(e?.message || "Ошибка загрузки чатов");
      return [];
    } finally {
      setChatsLoading(false);
    }
  };

  const loadContext = async () => {
    if (!session) return;
    setContextLoading(true);
    try {
      const r = await fetch("/api/specialist/ai-chat-context", {
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить контекст");
      setContextRooms(Array.isArray(j.rooms) ? j.rooms : []);
    } catch (e: any) {
      setErr(e?.message || "Ошибка загрузки контекста");
    } finally {
      setContextLoading(false);
    }
  };

  const loadChat = async (chatId: string) => {
    if (!session || !chatId) return;
    setErr("");
    const r = await fetch(`/api/specialist/ai-chat-chat?chat_id=${encodeURIComponent(chatId)}`, {
      headers: { authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) {
      setErr(j?.error || "Не удалось загрузить чат");
      return;
    }
    setActiveChatId(chatId);
    setMessages((j.messages || []).map(mapStoredMessage));
  };

  const newChat = () => {
    setActiveChatId("");
    setMessages([]);
    setDraft("");
    setPendingFiles([]);
    setErr("");
  };

  const startRenameChat = (chat: ChatSummary) => {
    setEditingChatId(chat.id);
    setEditingChatTitle(chat.title || "Новый чат");
  };

  const saveRenameChat = async () => {
    if (!session || !editingChatId) return;
    const title = editingChatTitle.trim();
    if (!title) return;
    try {
      const r = await fetch("/api/specialist/ai-chat-chats", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ chat_id: editingChatId, title }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось переименовать чат");
      setChats((prev) => prev.map((chat) => (chat.id === editingChatId ? j.chat : chat)));
      setEditingChatId("");
      setEditingChatTitle("");
    } catch (e: any) {
      setErr(e?.message || "Ошибка переименования чата");
    }
  };

  const deleteChat = async (chat: ChatSummary) => {
    if (!session || busy) return;
    if (!window.confirm(`Удалить чат "${chat.title || "Новый чат"}"?`)) return;
    try {
      const r = await fetch(`/api/specialist/ai-chat-chats?chat_id=${encodeURIComponent(chat.id)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось удалить чат");
      setChats((prev) => prev.filter((item) => item.id !== chat.id));
      if (activeChatId === chat.id) newChat();
    } catch (e: any) {
      setErr(e?.message || "Ошибка удаления чата");
    }
  };

  const loadTasks = async () => {
    if (!session) return;
    setTasksLoading(true);
    try {
      const r = await fetch("/api/specialist/ai-chat-tasks", {
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить задачи");
      setTasks(j.tasks || []);
    } catch (e: any) {
      setErr(e?.message || "Ошибка загрузки задач");
    } finally {
      setTasksLoading(false);
    }
  };

  const ensureTaskMessage = (task: AiTask) => {
    if (task.chat_id && task.chat_id !== activeChatId) {
      loadChat(task.chat_id);
      return;
    }
    setMessages((prev) => {
      if (prev.some((m) => m.taskId === task.id)) return prev;
      const requestMessages = Array.isArray(task.request_messages) ? task.request_messages : [];
      const lastUser = [...requestMessages].reverse().find((m) => m.role === "user");
      const next = [...prev];
      if (lastUser?.content) next.push({ id: `${task.id}-user`, role: "user", content: lastUser.content });
      next.push({
        id: task.id,
        taskId: task.id,
        role: "assistant",
        content:
          task.status === "completed"
            ? task.result_text || ""
            : task.status === "failed"
              ? task.error_text || "Задача завершилась ошибкой"
              : `${task.provider === "openai" ? "OpenAI" : "DeepSeek"} обрабатывает задачу. Статус: ${task.status}.`,
        provider: task.provider,
        model: task.model,
        pending: task.status === "queued" || task.status === "in_progress",
        durationMs: task.finished_at ? Math.max(0, Date.parse(task.finished_at) - Date.parse(task.started_at)) : undefined,
      });
      return next;
    });
  };

  const retryTask = (task: AiTask) => {
    const lastUser = [...(task.request_messages || [])].reverse().find((m) => m.role === "user")?.content || "";
    setProvider(task.provider);
    setModel(task.model);
    setDraft(lastUser);
    if (task.chat_id) loadChat(task.chat_id);
  };

  const copyTaskError = async (task: AiTask) => {
    const text = task.error_text || task.result_text || "";
    if (!text) return;
    try {
      await navigator.clipboard?.writeText(text);
    } catch {}
  };

  const changeProvider = (next: Provider) => {
    setProvider(next);
    setModel(next === "openai" ? "gpt-5.4-mini" : "deepseek-v4-pro");
    setActiveChatId("");
    setMessages([]);
    setPendingFiles([]);
    loadChats();
  };

  const previewFiles = async (files: PendingFile[]) => {
    if (!session || !files.length) return;
    try {
      const r = await fetch("/api/specialist/ai-chat-file-preview", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          files: files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, data: f.data })),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось извлечь текст файлов");
      const byId = new Map<string, any>((j.previews || []).map((p: any) => [String(p.id || ""), p]));
      setPendingFiles((prev) =>
        prev.map((file) => {
          const preview = byId.get(file.id);
          if (!preview) return file;
          return {
            ...file,
            previewLoading: false,
            preview: preview.preview || "",
            textChars: preview.textChars,
            truncated: Boolean(preview.truncated),
            previewError: preview.error || "",
          };
        })
      );
    } catch (e: any) {
      const message = e?.message || "Ошибка предпросмотра файла";
      setPendingFiles((prev) =>
        prev.map((file) => (files.some((x) => x.id === file.id) ? { ...file, previewLoading: false, previewError: message } : file))
      );
    }
  };

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || busy || activeTask) return;
    setErr("");
    try {
      const files = Array.from(fileList).slice(0, Math.max(0, 4 - pendingFiles.length));
      const next: PendingFile[] = [];
      for (const file of files) {
        const lower = file.name.toLowerCase();
        if (!/\.(docx|xlsx|xls|csv|txt|md|pdf)$/.test(lower)) {
          throw new Error(`Файл ${file.name}: поддерживаются .docx, .xlsx, .xls, .csv, .txt, .md, .pdf`);
        }
        if (file.size > 10 * 1024 * 1024) throw new Error(`Файл ${file.name}: максимум 10 МБ`);
        next.push({
          id: uid(),
          name: file.name,
          size: file.size,
          type: file.type || "",
          data: await readFileAsDataUrl(file),
          previewLoading: true,
        });
      }
      setPendingFiles((prev) => [...prev, ...next].slice(0, 4));
      previewFiles(next);
    } catch (e: any) {
      setErr(e?.message || "Не удалось добавить файл");
    }
  };

  const send = async () => {
    if (!session || busy || activeTask) return;
    const text = draft.trim();
    if (!text) return;

    const nextMessages: ChatMessage[] = [...messages, { id: uid(), role: "user", content: text }];
    const streamPendingId = provider === "deepseek" ? uid() : "";
    setMessages(
      streamPendingId
        ? [
            ...nextMessages,
            { id: streamPendingId, role: "assistant", content: "", provider, model, pending: true },
          ]
        : nextMessages
    );
    setDraft("");
    setErr("");
    setBusy(true);
    const started = Date.now();
    setStartedAt(started);
    setElapsedMs(0);
    const ticker = window.setInterval(() => setElapsedMs(Date.now() - started), 1000);

    const controller = new AbortController();
    abortRef.current = controller;
    let backgroundStarted = false;
    try {
      const r = await fetch("/api/specialist/ai-chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          provider,
          model,
          chat_id: activeChatId || undefined,
          temperature,
          max_output_tokens: maxOutputTokens,
          stream: provider === "deepseek",
          platform_context: platformContext,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          files: pendingFiles.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, data: f.data })),
        }),
        signal: controller.signal,
      });
      if (provider === "deepseek" && r.body && (r.headers.get("content-type") || "").includes("application/x-ndjson")) {
        if (!r.ok) throw new Error("Не удалось получить потоковый ответ");
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamText = "";
        let streamDone = false;

        const handleEvent = (event: any) => {
          if (event?.type === "meta") {
            if (event.chat?.id) {
              setActiveChatId(event.chat.id);
              setChats((prev) => [event.chat, ...prev.filter((c) => c.id !== event.chat.id)]);
            }
            return;
          }
          if (event?.type === "delta") {
            const delta = String(event.text || "");
            streamText += delta;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamPendingId
                  ? { ...m, content: streamText || "DeepSeek отвечает...", pending: true, durationMs: Date.now() - started }
                  : m
              )
            );
            return;
          }
          if (event?.type === "done") {
            streamDone = true;
            setPendingFiles([]);
            if (event.chat?.id) setActiveChatId(event.chat.id);
            if (event.task) setTasks((prev) => [event.task, ...prev.filter((t) => t.id !== event.task.id)]);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamPendingId
                  ? {
                      ...m,
                      content: String(event.text || streamText || ""),
                      pending: false,
                      durationMs: Date.now() - started,
                      taskId: event.task?.id,
                    }
                  : m
              )
            );
            return;
          }
          if (event?.type === "error") {
            throw new Error(event.error || "Ошибка потокового ответа");
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            handleEvent(JSON.parse(line));
          }
        }
        if (buffer.trim()) handleEvent(JSON.parse(buffer));
        if (!streamDone) throw new Error("Поток завершился без финального ответа");
        await loadChats();
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось получить ответ");
      setPendingFiles([]);
      if (j.chat?.id) {
        setActiveChatId(j.chat.id);
        setChats((prev) => [j.chat, ...prev.filter((c) => c.id !== j.chat.id)]);
      }
      if (provider === "openai" && j.responseId) {
        backgroundStarted = true;
        const task = j.task as AiTask | undefined;
        if (task) setTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
        const pendingId = task?.id || uid();
        setMessages((prev) => [
          ...prev,
          {
            id: pendingId,
            taskId: task?.id,
            role: "assistant",
            content: `OpenAI принял задачу в фон. Статус: ${j.status || "queued"}.`,
            provider,
            model,
            pending: true,
          },
        ]);
        pollOpenAI(task?.id || String(j.responseId), pendingId, started, ticker);
        await loadChats();
        return;
      }
      if (j.task) setTasks((prev) => [j.task, ...prev.filter((t) => t.id !== j.task.id)]);
      if (j.chat?.id) {
        await loadChat(j.chat.id);
        await loadChats();
        return;
      }
      await loadChats();
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: String(j.text || ""), provider, model, durationMs: Date.now() - started },
      ]);
    } catch (e: any) {
      if (streamPendingId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamPendingId ? { ...m, pending: false, content: e?.name === "AbortError" ? "Запрос остановлен" : e?.message || "Ошибка" } : m
          )
        );
      }
      if (e?.name !== "AbortError") setErr(e?.message || "Ошибка");
    } finally {
      if (!backgroundStarted) {
        window.clearInterval(ticker);
        setStartedAt(null);
        setBusy(false);
      }
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const pollOpenAI = (taskOrResponseId: string, pendingId: string, started: number, ticker: number) => {
    const poll = async () => {
      if (!session) return;
      try {
        const query = taskOrResponseId.startsWith("resp_")
          ? `response_id=${encodeURIComponent(taskOrResponseId)}`
          : `task_id=${encodeURIComponent(taskOrResponseId)}`;
        const r = await fetch(`/api/specialist/ai-chat-status?${query}`, {
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось проверить статус OpenAI");
        if (j.task) {
          setTasks((prev) => [j.task, ...prev.filter((t) => t.id !== j.task.id)]);
        }
        if (!j.done) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingId || m.taskId === taskOrResponseId
                ? { ...m, content: `OpenAI обрабатывает задачу. Статус: ${j.status}. Прошло: ${formatDuration(Date.now() - started)}.` }
                : m
            )
          );
          pollTimerRef.current = setTimeout(poll, 15000);
          return;
        }

        window.clearInterval(ticker);
        setStartedAt(null);
        setBusy(false);
        pollTimerRef.current = null;
        const durationMs = Date.now() - started;
        if (j.error) throw new Error(j.error);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId || m.taskId === taskOrResponseId
              ? { ...m, content: String(j.text || ""), pending: false, durationMs }
              : m
          )
        );
      } catch (e: any) {
        window.clearInterval(ticker);
        setStartedAt(null);
        setBusy(false);
        pollTimerRef.current = null;
        setErr(e?.message || "Ошибка");
        setMessages((prev) => prev.map((m) => (m.id === pendingId ? { ...m, pending: false, content: e?.message || "Ошибка" } : m)));
      }
    };
    pollTimerRef.current = setTimeout(poll, 3000);
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
    setStartedAt(null);
    setBusy(false);
  };

  if (!session || !user) {
    return (
      <Layout title="AI-чат">
        <div className="card text-sm text-zinc-700">
          Войдите, чтобы открыть AI-чат специалиста.
          <div className="mt-3">
            <Link href="/auth?next=%2Fspecialist%2Fai-chat" className="btn btn-secondary btn-sm">
              Вход / регистрация
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isSpecialistUser(user)) {
    return (
      <Layout title="AI-чат">
        <div className="card text-sm text-zinc-700">Этот раздел доступен только специалисту.</div>
      </Layout>
    );
  }

  return (
    <Layout title="AI-чат специалиста" widthClass="max-w-[1700px]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-600">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/specialist" className="btn btn-secondary btn-sm">
            К кабинету
          </Link>
          <Link href="/specialist/analysis" className="btn btn-secondary btn-sm">
            AI-аналитика
          </Link>
        </div>
        <button type="button" onClick={newChat} disabled={busy} className="btn btn-primary btn-sm disabled:opacity-50">
          Новый чат
        </button>
      </div>

      <div className="grid min-h-[calc(100vh-170px)] min-w-0 gap-3 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <aside className="card flex min-h-[360px] flex-col p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-zinc-900">Чаты</div>
            <button type="button" onClick={() => loadChats()} disabled={chatsLoading} className="btn btn-secondary btn-sm disabled:opacity-50">
              {chatsLoading ? "..." : "Обновить"}
            </button>
          </div>
          <input
            value={chatSearch}
            onChange={(e) => setChatSearch(e.target.value)}
            className="input mt-3 py-2 text-sm"
            placeholder="Поиск"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <select value={chatProviderFilter} onChange={(e) => setChatProviderFilter(e.target.value as ChatProviderFilter)} className="input py-2 text-xs">
              <option value="all">Все</option>
              <option value="deepseek">DeepSeek</option>
              <option value="openai">OpenAI</option>
            </select>
            <select value={chatModelFilter} onChange={(e) => setChatModelFilter(e.target.value)} className="input py-2 text-xs">
              <option value="all">Модели</option>
              {chatModelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
            {filteredChats.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-200 bg-white/70 p-3 text-xs text-zinc-500">Сохранённых чатов пока нет.</div>
            ) : (
              <div className="grid gap-2">
                {filteredChats.map((chat) => (
                  <div
                    key={chat.id}
                    className={`rounded-lg border p-2 text-xs transition ${
                      chat.id === activeChatId ? "border-indigo-300 bg-indigo-50" : "border-zinc-200 bg-white hover:bg-zinc-50"
                    }`}
                  >
                    {editingChatId === chat.id ? (
                      <div className="grid gap-2">
                        <input value={editingChatTitle} onChange={(e) => setEditingChatTitle(e.target.value)} className="input py-1.5 text-xs" autoFocus />
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={saveRenameChat} className="btn btn-primary btn-sm">
                            Сохранить
                          </button>
                          <button type="button" onClick={() => setEditingChatId("")} className="btn btn-secondary btn-sm">
                            Отмена
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button type="button" onClick={() => loadChat(chat.id)} className="block w-full min-w-0 text-left">
                          <div className="truncate font-medium text-zinc-900">{chat.title || "Новый чат"}</div>
                          <div className="mt-1 truncate text-zinc-500">
                            {chat.last_provider ? `${chat.last_provider === "openai" ? "OpenAI" : "DeepSeek"} · ${chat.last_model || ""}` : "Без запросов"}
                          </div>
                          <div className="mt-1 line-clamp-2 break-words text-zinc-500">{chat.last_user_message || "Пустой чат"}</div>
                        </button>
                        <div className="mt-2 flex gap-1">
                          <button type="button" onClick={() => startRenameChat(chat)} className="rounded px-2 py-1 text-zinc-500 hover:bg-white hover:text-zinc-900">
                            Назвать
                          </button>
                          <button type="button" onClick={() => deleteChat(chat)} disabled={busy} className="rounded px-2 py-1 text-red-600 hover:bg-white disabled:opacity-50">
                            Удалить
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="card grid min-h-[620px] min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden p-0">
          <div className="border-b border-zinc-100 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-950">{activeChat?.title || "Новый чат"}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span>{provider === "openai" ? "OpenAI" : "DeepSeek"} · {model}</span>
                  {selectedAttempt ? <span>Контекст: {selectedAttempt.test_title}</span> : selectedParticipant ? <span>Контекст: {selectedParticipant.display_name}</span> : selectedRoom ? <span>Контекст: {selectedRoom.name}</span> : null}
                  {pendingFiles.length ? <span>Файлы: {pendingFiles.length}</span> : null}
                </div>
              </div>
              <div className="text-xs text-zinc-500">
                {startedAt ? `Ожидание: ${formatDuration(elapsedMs)}` : activeTask ? "OpenAI-задача выполняется" : "Готов"}
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto bg-white px-4 py-5">
            {messages.length === 0 ? (
              <div className="mx-auto flex h-full max-w-2xl items-center justify-center text-center">
                <div>
                  <div className="text-lg font-semibold text-zinc-900">AI-чат специалиста</div>
                  <div className="mt-2 text-sm leading-relaxed text-zinc-500">
                    Выберите модель, добавьте контекст или файлы справа и напишите запрос.
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto grid max-w-4xl gap-5">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[86%] rounded-lg border px-4 py-3 text-sm shadow-sm ${
                        m.role === "user" ? "border-indigo-100 bg-indigo-50 text-zinc-900" : "border-zinc-200 bg-white text-zinc-900"
                      }`}
                    >
                      <div className="mb-1 text-xs font-medium text-zinc-500">
                        {m.role === "user" ? "Вы" : `${m.provider === "openai" ? "OpenAI" : "DeepSeek"} · ${m.model}`}
                        {m.durationMs ? ` · ${formatDuration(m.durationMs)}` : m.pending ? " · выполняется" : ""}
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed">{m.content || (m.pending ? "..." : "")}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-zinc-100 bg-white p-3">
            {err ? <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div> : null}
            <div className="mx-auto max-w-4xl rounded-xl border border-indigo-100 bg-white p-2 shadow-sm">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
                }}
                rows={3}
                className="min-h-[88px] w-full resize-none rounded-lg border-0 bg-transparent px-2 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                placeholder="Напишите сообщение"
                disabled={busy}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span>{provider === "openai" ? "OpenAI" : "DeepSeek"}</span>
                  <span>{model}</span>
                  {platformContext ? <span>контекст подключён</span> : null}
                  {pendingFiles.length ? <span>{pendingFiles.length} файл.</span> : null}
                </div>
                <div className="flex gap-2">
                  {busy ? (
                    <button type="button" onClick={stop} className="btn btn-secondary btn-sm">
                      Остановить
                    </button>
                  ) : null}
                  <button type="button" onClick={send} disabled={busy || !!activeTask || !draft.trim()} className="btn btn-primary btn-sm disabled:opacity-50">
                    {busy ? "Жду ответ..." : "Отправить"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>

        <aside className="grid content-start gap-3">
          <section className="card p-3">
            <div className="text-sm font-semibold text-zinc-900">Модель</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => changeProvider("deepseek")} className={`btn btn-sm ${provider === "deepseek" ? "btn-primary" : "btn-secondary"}`}>
                DeepSeek
              </button>
              <button type="button" onClick={() => changeProvider("openai")} className={`btn btn-sm ${provider === "openai" ? "btn-primary" : "btn-secondary"}`}>
                OpenAI
              </button>
            </div>
            <label className="mt-3 block text-xs font-medium text-zinc-700">Версия</label>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="input mt-1 py-2 text-sm">
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <label className="mt-3 block text-xs font-medium text-zinc-700">Креативность: {temperature.toFixed(1)}</label>
            <input type="range" min="0" max="1.5" step="0.1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="mt-2 w-full" />
            <label className="mt-3 block text-xs font-medium text-zinc-700">Максимум токенов</label>
            <input type="number" min="256" max="12000" step="256" value={maxOutputTokens} onChange={(e) => setMaxOutputTokens(Number(e.target.value))} className="input mt-1 py-2 text-sm" />
          </section>

          <section className="card p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-zinc-900">Контекст</div>
              <button type="button" onClick={loadContext} disabled={contextLoading} className="btn btn-secondary btn-sm disabled:opacity-50">
                {contextLoading ? "..." : "Обновить"}
              </button>
            </div>
            <label className="mt-3 block text-xs font-medium text-zinc-700">Комната</label>
            <select value={selectedRoomId} onChange={(e) => setSelectedRoomId(e.target.value)} className="input mt-1 py-2 text-sm">
              <option value="">Без контекста</option>
              {contextRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
            {selectedRoom ? (
              <>
                <label className="mt-3 block text-xs font-medium text-zinc-700">Участник</label>
                <select value={selectedParticipantId} onChange={(e) => setSelectedParticipantId(e.target.value)} className="input mt-1 py-2 text-sm">
                  <option value="">Вся комната</option>
                  {selectedRoom.participants.map((participant) => (
                    <option key={participant.user_id} value={participant.user_id}>
                      {participant.display_name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            {selectedParticipant ? (
              <>
                <label className="mt-3 block text-xs font-medium text-zinc-700">Попытка</label>
                <select value={selectedAttemptId} onChange={(e) => setSelectedAttemptId(e.target.value)} className="input mt-1 py-2 text-sm">
                  <option value="">Все попытки</option>
                  {selectedParticipant.attempts.map((attempt) => (
                    <option key={attempt.id} value={attempt.id}>
                      {attempt.test_title} · {new Date(attempt.created_at).toLocaleDateString("ru-RU")}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            {platformContext ? (
              <div className="mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-600">
                {platformContext}
              </div>
            ) : null}
          </section>

          <section className="card p-3">
            <div className="text-sm font-semibold text-zinc-900">Файлы</div>
            <label className={`btn btn-secondary btn-sm mt-3 w-full ${busy || activeTask ? "pointer-events-none opacity-50" : ""}`}>
              Добавить файл
              <input
                type="file"
                accept=".docx,.xlsx,.xls,.csv,.txt,.md,.pdf"
                multiple
                className="hidden"
                disabled={busy || !!activeTask}
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {pendingFiles.length ? (
              <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
                {pendingFiles.map((file) => (
                  <div key={file.id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-800">{file.name}</div>
                        <div className="text-zinc-500">
                          {formatBytes(file.size)}
                          {file.textChars ? ` · ${file.textChars} симв.` : ""}
                          {file.truncated ? " · обрезан" : ""}
                        </div>
                      </div>
                      <button type="button" onClick={() => setPendingFiles((prev) => prev.filter((x) => x.id !== file.id))} disabled={busy} className="text-zinc-500 hover:text-red-600 disabled:opacity-50">
                        Убрать
                      </button>
                    </div>
                    {file.previewLoading ? <div className="mt-2 text-zinc-500">Извлекаю текст...</div> : null}
                    {file.previewError ? <div className="mt-2 text-red-600">{file.previewError}</div> : null}
                    {file.preview ? <div className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-200 bg-white p-2 leading-relaxed text-zinc-600">{file.preview}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-zinc-200 bg-white/70 p-3 text-xs text-zinc-500">PDF, DOCX, XLSX, CSV, TXT, MD до 10 МБ.</div>
            )}
          </section>

          <section className="card p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-zinc-900">Задачи</div>
              <button type="button" onClick={loadTasks} disabled={tasksLoading} className="btn btn-secondary btn-sm disabled:opacity-50">
                {tasksLoading ? "..." : "Обновить"}
              </button>
            </div>
            <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1">
              {tasks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-white/70 p-3 text-xs text-zinc-500">Сохранённых задач пока нет.</div>
              ) : (
                tasks.slice(0, 6).map((task) => {
                  const pending = task.status === "queued" || task.status === "in_progress";
                  const duration = task.finished_at
                    ? Math.max(0, Date.parse(task.finished_at) - Date.parse(task.started_at))
                    : Math.max(0, Date.now() - Date.parse(task.started_at));
                  return (
                    <div key={task.id} className="rounded-lg border border-zinc-200 bg-white p-2 text-xs">
                      <button type="button" onClick={() => ensureTaskMessage(task)} className="block w-full min-w-0 text-left">
                        <div className="truncate font-medium text-zinc-800">
                          {task.provider === "openai" ? "OpenAI" : "DeepSeek"} · {task.model}
                        </div>
                        <div className={pending ? "text-amber-700" : task.status === "completed" ? "text-emerald-700" : "text-red-700"}>
                          {task.status} · {formatDuration(duration)}
                        </div>
                        <div className="mt-1 line-clamp-2 break-words text-zinc-500">
                          {task.result_text || task.error_text || task.request_messages?.find((m) => m.role === "user")?.content || "Задача"}
                        </div>
                      </button>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <button type="button" onClick={() => ensureTaskMessage(task)} className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900">
                          Открыть
                        </button>
                        <button type="button" onClick={() => retryTask(task)} className="rounded px-2 py-1 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900">
                          Повторить
                        </button>
                        {task.error_text ? (
                          <button type="button" onClick={() => copyTaskError(task)} className="rounded px-2 py-1 text-red-600 hover:bg-red-50">
                            Ошибка
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </Layout>
  );
}
