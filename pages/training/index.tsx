import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";

type Room = { id: string; name: string; created_at: string; created_by_email: string | null; is_joined?: boolean };

export default function TrainingHome() {
  const { session, user } = useSession();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [joinRoomId, setJoinRoomId] = useState<string>("");
  const [joinName, setJoinName] = useState<string>("");
  const [joinPwd, setJoinPwd] = useState<string>("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [joinConsent, setJoinConsent] = useState(false);

  const NAME_KEY = "training_display_name_v1";

  const saveNameLocal = (name: string) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (joinName) return;
    try {
      const val = String(localStorage.getItem(NAME_KEY) || "").trim();
      if (val) setJoinName(val);
    } catch {
      // ignore
    }
  }, [joinName]);

  useEffect(() => {
    if (user?.email && !joinName) setJoinName(user.email.split("@")[0]);
  }, [user?.email, joinName]);

  const canLoad = !!session?.access_token;

  const loadRooms = async () => {
    if (!session) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/training/rooms/list", {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить комнаты");
      setRooms(j.rooms || []);
    } catch (e: any) {
      setErr(e?.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canLoad) return;
    loadRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoad]);


  const openRoom = (room: Room) => {
    if (room.is_joined) {
      window.location.href = `/training/rooms/${encodeURIComponent(room.id)}`;
      return;
    }
    setJoinRoomId(room.id);
    setJoinPwd("");
    setJoinError("");
    setJoinConsent(false);
  };

  const join = async () => {
    if (!session) return;
    setJoinError("");
    setJoinBusy(true);
    try {
      const payload = { room_id: joinRoomId, password: joinPwd, display_name: joinName, personal_data_consent: joinConsent };
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const r = await fetch("/api/training/rooms/join", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok && j?.ok) {
          const safeName = String(joinName || "").trim();
          saveNameLocal(safeName);
          window.location.href = `/training/rooms/${encodeURIComponent(joinRoomId)}`;
          return;
        }
        if (r.status === 202 && j?.queued) {
          const retryAfter = Math.max(500, Number(j?.retry_after_ms || 1500));
          const approx = Number(j?.approx_position || 0);
          setJoinError(approx > 0
            ? `Сейчас много входов. Подключаем вас в порядке очереди… Позиция примерно: ${approx}`
            : String(j?.error || "Сейчас много входов, подключаем вас в порядке очереди…"));
          await new Promise((resolve) => setTimeout(resolve, retryAfter));
          continue;
        }
        throw new Error(j?.error || "Не удалось войти");
      }
      throw new Error("Слишком много одновременных входов. Попробуйте ещё раз через несколько секунд.");
    } catch (e: any) {
      setJoinError(e?.message || "Ошибка");
    } finally {
      setJoinBusy(false);
    }
  };

  if (!session || !user) {
    return (
      <Layout title="Комнаты">
        <div className="card text-sm text-zinc-700">
          Чтобы войти в комнату, нужно авторизоваться.
          <div className="mt-3">
            <Link href="/auth?next=%2Ftraining" className="btn btn-secondary btn-sm">
              Вход / регистрация
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Комнаты">
      <div className="mb-4 card text-sm text-zinc-700">
        Выберите комнату и войдите по паролю тренера. После входа появится список тестов.
      </div>

      <div className="grid gap-3">
        {err ? (
          <div className="card text-sm text-red-600">{err}</div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-zinc-600">{loading ? "Загрузка…" : `Комнат: ${rooms.length}`}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadRooms}
              disabled={loading}
              className="btn btn-secondary btn-sm"
            >
              Обновить
            </button>
          </div>
        </div>

        {rooms.map((room) => {
          const canOpenDirect = Boolean(room.is_joined);
          return (
          <div
            key={room.id}
            className="card cursor-pointer transition hover:border-zinc-300 hover:bg-white/90"
            role="button"
            tabIndex={0}
            onClick={() => openRoom(room)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openRoom(room);
              }
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-lg font-semibold">{room.name}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {room.created_by_email ? `Создатель: ${room.created_by_email}` : ""}
                </div>
                {/* production UI: no extra session/status badges here */}
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Link
                  href="/training/my-results"
                  onClick={(e) => e.stopPropagation()}
                  className="btn btn-secondary btn-sm w-full sm:w-auto"
                >
                  Мои результаты
                </Link>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openRoom(room);
                  }}
                  className="btn btn-secondary btn-sm w-full sm:w-auto"
                >
                  {canOpenDirect ? "Открыть" : "Войти"}
                </button>
              </div>
            </div>

            {joinRoomId === room.id ? (
              <div className="mt-3 grid gap-2 card-soft p-3">
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-zinc-700">Ваше имя в комнате</div>
                  <input value={joinName} onChange={(e) => setJoinName(e.target.value)} onClick={(e) => e.stopPropagation()} className="input" placeholder="Например: Алекс" />
                </div>
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-zinc-700">Пароль комнаты</div>
                  <input type="password" value={joinPwd} onChange={(e) => setJoinPwd(e.target.value)} onClick={(e) => e.stopPropagation()} className="input" placeholder="Пароль от тренера" autoComplete="current-password" />
                </div>
                <label
                  className="mt-1 flex items-start gap-2 rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm text-zinc-700"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={joinConsent}
                    onChange={(e) => setJoinConsent(e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 h-4 w-4 rounded border-zinc-300"
                  />
                  <span>
                    Я даю согласие на обработку моих персональных данных для участия в тестировании, обработки результатов и предоставления их специалисту.
                  </span>
                </label>
                <div className="-mt-1 text-xs leading-5 text-zinc-500">
                  Продолжая, вы подтверждаете, что ознакомились с{' '}
                  <Link href="/legal/privacy" onClick={(e) => e.stopPropagation()} className="underline underline-offset-2 hover:text-zinc-700">
                    Политикой обработки персональных данных
                  </Link>{' '}
                  и{' '}
                  <Link href="/legal/personal-data-consent" onClick={(e) => e.stopPropagation()} className="underline underline-offset-2 hover:text-zinc-700">
                    Согласием на обработку персональных данных
                  </Link>
                  .
                </div>
                {joinError ? <div className="text-sm text-red-600">{joinError}</div> : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button onClick={(e) => { e.stopPropagation(); join(); }} disabled={joinBusy || !joinPwd || !joinName || !joinConsent} className="btn btn-primary w-full sm:w-auto">
                    {joinBusy ? "Входим…" : "Войти"}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setJoinRoomId(""); }}
                    className="btn btn-secondary w-full sm:w-auto"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          );
        })}

        {rooms.length === 0 && !loading ? (
          <div className="card text-sm text-zinc-600">
            Пока нет активных комнат.
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
