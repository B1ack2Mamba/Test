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

type AiTask = {
  id: string;
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

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  const activeTask = tasks.find((t) => t.provider === "openai" && (t.status === "queued" || t.status === "in_progress")) || null;

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
              : `OpenAI обрабатывает задачу. Статус: ${task.status}.`,
        provider: "openai",
        model: task.model,
        pending: task.status === "queued" || task.status === "in_progress",
        durationMs: task.finished_at ? Math.max(0, Date.parse(task.finished_at) - Date.parse(task.started_at)) : undefined,
      });
      return next;
    });
  };

  const changeProvider = (next: Provider) => {
    setProvider(next);
    setModel(next === "openai" ? "gpt-5.4-mini" : "deepseek-v4-pro");
  };

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || busy || activeTask) return;
    setErr("");
    try {
      const files = Array.from(fileList).slice(0, Math.max(0, 4 - pendingFiles.length));
      const next: PendingFile[] = [];
      for (const file of files) {
        const lower = file.name.toLowerCase();
        if (!/\.(docx|xlsx|xls|csv|txt|md)$/.test(lower)) {
          throw new Error(`Файл ${file.name}: поддерживаются .docx, .xlsx, .xls, .csv, .txt, .md`);
        }
        if (file.size > 10 * 1024 * 1024) throw new Error(`Файл ${file.name}: максимум 10 МБ`);
        next.push({
          id: uid(),
          name: file.name,
          size: file.size,
          type: file.type || "",
          data: await readFileAsDataUrl(file),
        });
      }
      setPendingFiles((prev) => [...prev, ...next].slice(0, 4));
    } catch (e: any) {
      setErr(e?.message || "Не удалось добавить файл");
    }
  };

  const send = async () => {
    if (!session || busy || activeTask) return;
    const text = draft.trim();
    if (!text) return;

    const nextMessages: ChatMessage[] = [...messages, { id: uid(), role: "user", content: text }];
    setMessages(nextMessages);
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
          temperature,
          max_output_tokens: maxOutputTokens,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          files: pendingFiles.map((f) => ({ name: f.name, type: f.type, size: f.size, data: f.data })),
        }),
        signal: controller.signal,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось получить ответ");
      setPendingFiles([]);
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
        return;
      }
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: String(j.text || ""), provider, model, durationMs: Date.now() - started },
      ]);
    } catch (e: any) {
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
    <Layout title="AI-чат специалиста">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
        <Link href="/specialist" className="btn btn-secondary btn-sm">
          К кабинету специалиста
        </Link>
        <Link href="/specialist/analysis" className="btn btn-secondary btn-sm">
          AI-аналитика клиентов
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="card self-start">
          <div className="text-sm font-semibold">Модель</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => changeProvider("deepseek")}
              className={`btn btn-sm ${provider === "deepseek" ? "btn-primary" : "btn-secondary"}`}
            >
              DeepSeek
            </button>
            <button
              type="button"
              onClick={() => changeProvider("openai")}
              className={`btn btn-sm ${provider === "openai" ? "btn-primary" : "btn-secondary"}`}
            >
              OpenAI
            </button>
          </div>

          <label className="mt-4 block text-xs font-medium text-zinc-700">Версия</label>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="input mt-1">
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>

          <label className="mt-4 block text-xs font-medium text-zinc-700">
            Креативность ответа: {temperature.toFixed(1)}
          </label>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            className="mt-2 w-full"
          />
          <div className="mt-1 text-xs text-zinc-500">0 — строже и стабильнее, 1+ — свободнее и разнообразнее.</div>

          <label className="mt-4 block text-xs font-medium text-zinc-700">Максимум токенов ответа</label>
          <input
            type="number"
            min="256"
            max="12000"
            step="256"
            value={maxOutputTokens}
            onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
            className="input mt-1"
          />

          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setErr("");
            }}
            disabled={busy || messages.length === 0}
            className="btn btn-secondary btn-sm mt-4 w-full disabled:opacity-50"
          >
            Очистить чат
          </button>

          <div className="mt-5 border-t border-zinc-200 pt-4">
            <div className="text-sm font-semibold">Файлы для анализа</div>
            <label className={`btn btn-secondary btn-sm mt-3 w-full ${busy || activeTask ? "pointer-events-none opacity-50" : ""}`}>
              Добавить файл
              <input
                type="file"
                accept=".docx,.xlsx,.xls,.csv,.txt,.md"
                multiple
                className="hidden"
                disabled={busy || !!activeTask}
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <div className="mt-2 text-xs text-zinc-500">До 4 файлов, каждый до 10 МБ.</div>
            {pendingFiles.length ? (
              <div className="mt-3 grid gap-2">
                {pendingFiles.map((file) => (
                  <div key={file.id} className="flex items-start justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-zinc-800">{file.name}</div>
                      <div className="text-zinc-500">{formatBytes(file.size)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingFiles((prev) => prev.filter((x) => x.id !== file.id))}
                      disabled={busy}
                      className="text-zinc-500 hover:text-red-600 disabled:opacity-50"
                    >
                      Убрать
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-5 border-t border-zinc-200 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">OpenAI-задачи</div>
              <button type="button" onClick={loadTasks} disabled={tasksLoading} className="btn btn-secondary btn-sm disabled:opacity-50">
                {tasksLoading ? "..." : "Обновить"}
              </button>
            </div>
            <div className="mt-3 grid gap-2">
              {tasks.length === 0 ? (
                <div className="text-xs text-zinc-500">Сохранённых задач пока нет.</div>
              ) : (
                tasks.slice(0, 6).map((task) => {
                  const pending = task.status === "queued" || task.status === "in_progress";
                  const duration = task.finished_at
                    ? Math.max(0, Date.parse(task.finished_at) - Date.parse(task.started_at))
                    : Math.max(0, Date.now() - Date.parse(task.started_at));
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => ensureTaskMessage(task)}
                      className="rounded-lg border border-zinc-200 bg-white p-2 text-left text-xs hover:bg-zinc-50"
                    >
                      <div className="font-medium text-zinc-800">{task.model}</div>
                      <div className={pending ? "text-amber-700" : task.status === "completed" ? "text-emerald-700" : "text-red-700"}>
                        {task.status} · {formatDuration(duration)}
                      </div>
                      <div className="mt-1 truncate text-zinc-500">
                        {task.result_text || task.error_text || task.request_messages?.find((m) => m.role === "user")?.content || "Задача"}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="grid min-h-[70vh] grid-rows-[1fr_auto] gap-3">
          <div className="card min-h-[420px] overflow-hidden">
            <div className="h-full max-h-[62vh] overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <div className="text-sm text-zinc-500">
                  Напишите запрос к модели. История текущего чата отправляется вместе с новым сообщением.
                </div>
              ) : (
                <div className="grid gap-3">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg border p-3 text-sm ${
                        m.role === "user" ? "border-zinc-200 bg-zinc-50" : "border-emerald-100 bg-emerald-50"
                      }`}
                    >
                      <div className="mb-1 text-xs font-semibold text-zinc-500">
                        {m.role === "user" ? "Вы" : `${m.provider === "openai" ? "OpenAI" : "DeepSeek"} · ${m.model}`}
                        {m.durationMs ? ` · время: ${formatDuration(m.durationMs)}` : m.pending ? " · выполняется" : ""}
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed text-zinc-800">{m.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            {err ? <div className="mb-2 text-sm text-red-600">{err}</div> : null}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
              }}
              rows={5}
              className="input min-h-[120px]"
              placeholder="Введите запрос"
              disabled={busy}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-zinc-500">
                {startedAt ? `Время ожидания: ${formatDuration(elapsedMs)}` : activeTask ? "Есть незавершённая OpenAI-задача." : provider === "openai" ? "Нужен OPENAI_API_KEY на сервере." : "Используется DEEPSEEK_API_KEY на сервере."}
              </div>
              <div className="flex gap-2">
                {busy ? (
                  <button type="button" onClick={stop} className="btn btn-secondary">
                    Остановить
                  </button>
                ) : null}
                <button type="button" onClick={send} disabled={busy || !!activeTask || !draft.trim()} className="btn btn-primary disabled:opacity-50">
                  {busy ? "Жду ответ..." : "Отправить"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
