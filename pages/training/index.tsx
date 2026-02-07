import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";

type Room = { id: string; name: string; created_at: string; created_by_email: string | null };

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

  useEffect(() => {
    if (!user?.email) return;
    setJoinName(user.email.split("@")[0]);
  }, [user?.email]);

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

  const join = async () => {
    if (!session) return;
    setJoinError("");
    setJoinBusy(true);
    try {
      const r = await fetch("/api/training/rooms/join", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: joinRoomId, password: joinPwd, display_name: joinName }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось войти");
      // go to room
      window.location.href = `/training/rooms/${encodeURIComponent(joinRoomId)}`;
    } catch (e: any) {
      setJoinError(e?.message || "Ошибка");
    } finally {
      setJoinBusy(false);
    }
  };

  if (!session || !user) {
    return (
      <Layout title="Тренинг">
        <div className="card text-sm text-zinc-700">
          Для участия в тренинге нужно войти.
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
    <Layout title="Тренинг">
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

        {rooms.map((room) => (
          <div key={room.id} className="card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-lg font-semibold">{room.name}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {room.created_by_email ? `Создатель: ${room.created_by_email}` : ""}
                </div>
              </div>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Link
                  href="/training/my-results"
                  className="btn btn-secondary btn-sm w-full sm:w-auto"
                >
                  Мои результаты
                </Link>
                <button
                  onClick={() => {
                    setJoinRoomId(room.id);
                    setJoinPwd("");
                    setJoinError("");
                  }}
                  className="btn btn-secondary btn-sm w-full sm:w-auto"
                >
                  Войти
                </button>
              </div>
            </div>

            {joinRoomId === room.id ? (
              <div className="mt-3 grid gap-2 card-soft p-3">
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-zinc-700">Ваше имя в комнате</div>
                  <input value={joinName} onChange={(e) => setJoinName(e.target.value)} className="input" placeholder="Например: Алекс" />
                </div>
                <div className="grid gap-1">
                  <div className="text-xs font-medium text-zinc-700">Пароль комнаты</div>
                  <input value={joinPwd} onChange={(e) => setJoinPwd(e.target.value)} className="input" placeholder="Пароль от тренера" />
                </div>
                {joinError ? <div className="text-sm text-red-600">{joinError}</div> : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button onClick={join} disabled={joinBusy || !joinPwd || !joinName} className="btn btn-primary w-full sm:w-auto">
                    {joinBusy ? "Входим…" : "Войти"}
                  </button>
                  <button
                    onClick={() => setJoinRoomId("")}
                    className="btn btn-secondary w-full sm:w-auto"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {rooms.length === 0 && !loading ? (
          <div className="card text-sm text-zinc-600">
            Пока нет активных комнат.
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
