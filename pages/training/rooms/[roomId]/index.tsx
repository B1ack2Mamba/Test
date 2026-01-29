import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";
import type { AnyTest } from "@/lib/testTypes";

type Props = { tests: AnyTest[] };

type RoomInfo = { id: string; name: string; created_by_email: string | null; is_active: boolean };
type MemberInfo = { role: string; display_name: string };

type ProgressRow = { test_slug: string; started_at: string | null; completed_at: string | null; attempt_id: string | null };

export default function TrainingRoom({ tests }: Props) {
  const router = useRouter();
  const roomId = String(router.query.roomId || "");
  const { session, user } = useSession();

  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // join form (if not joined)
  const [joinName, setJoinName] = useState("");
  const [joinPwd, setJoinPwd] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    if (user?.email && !joinName) setJoinName(user.email.split("@")[0]);
  }, [user?.email, joinName]);

  const load = async () => {
    if (!session || !roomId) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/training/rooms/get?room_id=${encodeURIComponent(roomId)}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось загрузить комнату");
      setRoom(j.room);
      setMember(j.member);

      const pr = await fetch(`/api/training/progress/my?room_id=${encodeURIComponent(roomId)}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const pj = await pr.json();
      if (!pr.ok || !pj?.ok) throw new Error(pj?.error || "Не удалось загрузить прогресс");
      setProgress(pj.progress || []);
    } catch (e: any) {
      setErr(e?.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!session || !roomId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, roomId]);

  // presence ping
  useEffect(() => {
    if (!session || !roomId || !member) return;
    const tick = async () => {
      await fetch("/api/training/rooms/touch", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: roomId }),
      }).catch(() => null);
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [session, roomId, member]);

  const bySlug = useMemo(() => {
    const m = new Map<string, ProgressRow>();
    for (const row of progress) m.set(row.test_slug, row);
    return m;
  }, [progress]);

  const join = async () => {
    if (!session) return;
    setJoinBusy(true);
    setJoinError("");
    try {
      const r = await fetch("/api/training/rooms/join", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: roomId, password: joinPwd, display_name: joinName }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось войти");
      setMember({ role: j.member.role, display_name: j.member.display_name });
      setJoinPwd("");
      await load();
    } catch (e: any) {
      setJoinError(e?.message || "Ошибка");
    } finally {
      setJoinBusy(false);
    }
  };

  if (!session || !user) {
    return (
      <Layout title="Комната тренинга">
        <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-700">
          Нужно войти, чтобы открыть комнату.
          <div className="mt-3">
            <Link
              href={`/auth?next=${encodeURIComponent(`/training/rooms/${roomId || ""}`)}`}
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
            >
              Вход / регистрация
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={room ? room.name : "Комната тренинга"}>
      {err ? <div className="mb-3 rounded-2xl border bg-white p-4 text-sm text-red-600">{err}</div> : null}

      <div className="mb-4 rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm text-zinc-600">Комната</div>
            <div className="text-lg font-semibold">{room?.name || "…"}</div>
            <div className="mt-1 text-xs text-zinc-500">
              {member ? `Вы вошли как: ${member.display_name}` : "Вы ещё не вошли в комнату"}
            </div>
          </div>
          <div className="flex items-center gap-2">

            <Link
              href="/training/my-results"
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
            >
              Мои результаты
            </Link>

            <button
              onClick={load}
              disabled={loading}
              className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50"
            >
              {loading ? "…" : "Обновить"}
            </button>

          </div>
        </div>

        {!member ? (
          <div className="mt-4 grid gap-2 rounded-xl border bg-zinc-50 p-3">
            <div className="text-sm font-medium">Войти в комнату</div>
            <div className="grid gap-1">
              <div className="text-xs font-medium text-zinc-700">Имя</div>
              <input
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="grid gap-1">
              <div className="text-xs font-medium text-zinc-700">Пароль комнаты</div>
              <input
                value={joinPwd}
                onChange={(e) => setJoinPwd(e.target.value)}
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm"
              />
            </div>
            {joinError ? <div className="text-sm text-red-600">{joinError}</div> : null}
            <div className="flex items-center gap-2">
              <button
                onClick={join}
                disabled={joinBusy || !joinPwd || !joinName}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {joinBusy ? "Входим…" : "Войти"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 text-xs text-zinc-500">
            Примечание: результаты в цифрах доступны только специалисту в комнате.
          </div>
        )}
      </div>

      {member ? (
        <div className="grid gap-3">
          {tests.map((t) => {
            const pr = bySlug.get(t.slug);
            const done = !!pr?.completed_at;
            return (
              <div key={t.slug} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">{t.title}</div>
                    {t.description ? <div className="mt-1 text-sm text-zinc-600">{t.description}</div> : null}
                    <div className="mt-2 text-xs text-zinc-500">
                      {done ? "✅ Завершён" : "⏳ Не пройден"} · {t.questions?.length ?? 0} вопросов
                    </div>
                  </div>
                  <Link
                    href={`/training/rooms/${encodeURIComponent(roomId)}/tests/${encodeURIComponent(t.slug)}/take`}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
                  >
                    {done ? "Пройти ещё раз" : "Начать"}
                  </Link>
                </div>

                {done && pr?.attempt_id ? (
                  <div className="mt-3">
                    <Link
                      href={`/training/rooms/${encodeURIComponent(roomId)}/tests/${encodeURIComponent(t.slug)}/done?attempt=${encodeURIComponent(
                        pr.attempt_id
                      )}`}
                      className="text-sm font-medium text-zinc-900 underline"
                    >
                      Открыть страницу завершения
                    </Link>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-600">
          Войдите в комнату, чтобы увидеть тесты.
        </div>
      )}
    </Layout>
  );
}

export async function getServerSideProps() {
  const { getAllTests } = await import("@/lib/loadTests");
  const tests = await getAllTests();
  return { props: { tests } };
}
