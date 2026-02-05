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

  const NAME_KEY = "training_display_name_v1";
  const NAME_EXP_KEY = "training_display_name_exp_v1";
  const NAME_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  // Room-specific test settings (enabled/order/etc.)
  const [roomTests, setRoomTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // join form (if not joined)
  const [joinName, setJoinName] = useState("");
  const [joinPwd, setJoinPwd] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState("");

  // rename display name (after joined)
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameMsg, setRenameMsg] = useState("");

  const saveNameLocal = (name: string) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(NAME_KEY, name);
      localStorage.setItem(NAME_EXP_KEY, String(Date.now() + NAME_TTL_MS));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (joinName) return;
    try {
      const exp = Number(localStorage.getItem(NAME_EXP_KEY) || "0");
      const val = String(localStorage.getItem(NAME_KEY) || "");
      if (val && exp && exp > Date.now()) {
        setJoinName(val);
      } else {
        localStorage.removeItem(NAME_KEY);
        localStorage.removeItem(NAME_EXP_KEY);
      }
    } catch {
      // ignore
    }
  }, [roomId, joinName]);

  useEffect(() => {
    if (user?.email && !joinName) setJoinName(user.email.split("@")[0]);
  }, [user?.email, joinName]);

  useEffect(() => {
    if (member?.display_name) {
      setRenameValue(member.display_name);
    }
  }, [member?.display_name]);

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

      const tr = await fetch(`/api/training/rooms/tests/get?room_id=${encodeURIComponent(roomId)}`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      });
      const tj = await tr.json();
      if (tr.ok && tj?.ok) {
        setRoomTests(tj.room_tests || []);
      }

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

  // presence ping (online status for the specialist dashboard)
  useEffect(() => {
    if (!session || !roomId || !member) return;

    let alive = true;

    const tick = async () => {
      if (!alive) return;
      await fetch("/api/training/rooms/touch", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: roomId }),
      }).catch(() => null);
    };

    // initial ping
    tick();

    const id = setInterval(() => {
      if (document.hidden) return;
      tick();
    }, 90_000);

    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [session?.access_token, roomId, member]);

  const bySlug = useMemo(() => {
    const m = new Map<string, ProgressRow>();
    for (const row of progress) m.set(row.test_slug, row);
    return m;
  }, [progress]);

  const testsBySlug = useMemo(() => {
    const m = new Map<string, AnyTest>();
    for (const t of tests) m.set(t.slug, t);
    return m;
  }, [tests]);

  const enabledTests = useMemo(() => {
    const base = Array.isArray(roomTests) && roomTests.length ? roomTests : tests.map((t, i) => ({ test_slug: t.slug, is_enabled: true, sort_order: i }));
    const ordered = [...base].sort((a: any, b: any) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
    return ordered
      .filter((r: any) => !!r.is_enabled)
      .map((r: any) => testsBySlug.get(String(r.test_slug)))
      .filter(Boolean) as AnyTest[];
  }, [roomTests, testsBySlug, tests]);

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
      saveNameLocal(String(j.member.display_name || joinName));
      setJoinPwd("");
      await load();
    } catch (e: any) {
      setJoinError(e?.message || "Ошибка");
    } finally {
      setJoinBusy(false);
    }
  };

  const saveRename = async () => {
    if (!session || !roomId) return;
    const name = (renameValue || "").trim();
    if (!name) {
      setRenameMsg("Имя пустое");
      setTimeout(() => setRenameMsg(""), 2500);
      return;
    }
    setRenameBusy(true);
    setRenameMsg("");
    try {
      const r = await fetch("/api/training/rooms/update-member-name", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ room_id: roomId, display_name: name }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось сохранить");
      setMember((prev) => (prev ? { ...prev, display_name: name } : prev));
      saveNameLocal(name);
      setRenameOpen(false);
      setRenameMsg("Сохранено ✅");
      setTimeout(() => setRenameMsg(""), 2500);
    } catch (e: any) {
      setRenameMsg(e?.message || "Ошибка");
    } finally {
      setRenameBusy(false);
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
              {member ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    Вы вошли как: <b className="text-zinc-800">{member.display_name}</b>
                  </span>
                  <button
                    onClick={() => setRenameOpen((v) => !v)}
                    className="rounded-md border bg-white px-2 py-0.5 text-[11px] font-medium hover:bg-zinc-50"
                  >
                    {renameOpen ? "Скрыть" : "Изменить имя"}
                  </button>
                </div>
              ) : (
                "Вы ещё не вошли в комнату"
              )}
            </div>

            {member && renameOpen ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="w-full max-w-[360px] rounded-xl border bg-white px-3 py-2 text-sm"
                  placeholder="Ваше имя"
                />
                <button
                  onClick={saveRename}
                  disabled={renameBusy || !renameValue.trim()}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {renameBusy ? "…" : "Сохранить"}
                </button>
                {renameMsg ? <div className="text-xs text-zinc-600">{renameMsg}</div> : null}
              </div>
            ) : null}
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
          {enabledTests.map((t) => {
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
