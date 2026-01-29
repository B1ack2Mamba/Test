import { useEffect, useState } from "react";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { useSession } from "@/lib/useSession";
import { isSpecialistUser } from "@/lib/specialist";

type Room = { id: string; name: string; created_at: string; is_active: boolean };

export default function SpecialistHome() {
  const { session, user } = useSession();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [name, setName] = useState("");
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [createErr, setCreateErr] = useState("");

  const load = async () => {
    if (!session) return;
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/training/rooms/my", {
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
    if (!session) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  const create = async () => {
    if (!session) return;
    setBusy(true);
    setCreateErr("");
    try {
      const r = await fetch("/api/training/rooms/create", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ name, password: pwd }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || "Не удалось создать комнату");
      setName("");
      setPwd("");
      await load();
    } catch (e: any) {
      setCreateErr(e?.message || "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  if (!session || !user) {
    return (
      <Layout title="Специалист">
        <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-700">
          Войдите, чтобы открыть кабинет специалиста.
          <div className="mt-3">
            <Link href="/auth?next=%2Fspecialist" className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50">
              Вход / регистрация
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isSpecialistUser(user)) {
    return (
      <Layout title="Специалист">
        <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-700">
          Этот раздел доступен только специалисту.
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Кабинет специалиста">
      <div className="mb-4 rounded-2xl border bg-white p-4 text-sm text-zinc-700">
        Здесь вы создаёте комнаты тренинга, наблюдаете участников и открываете результаты в цифрах.
      </div>

      <div className="mb-6 rounded-2xl border bg-white p-4">
        <div className="text-sm font-semibold">Создать комнату</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1">
            <div className="text-xs font-medium text-zinc-700">Название</div>
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border bg-white px-3 py-2 text-sm" />
          </div>
          <div className="grid gap-1">
            <div className="text-xs font-medium text-zinc-700">Пароль</div>
            <input value={pwd} onChange={(e) => setPwd(e.target.value)} className="rounded-lg border bg-white px-3 py-2 text-sm" />
          </div>
        </div>
        {createErr ? <div className="mt-2 text-sm text-red-600">{createErr}</div> : null}
        <button
          onClick={create}
          disabled={busy || !name.trim() || pwd.trim().length < 4}
          className="mt-3 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "…" : "Создать"}
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-zinc-600">{loading ? "Загрузка…" : `Мои комнаты: ${rooms.length}`}</div>
        <button onClick={load} disabled={loading} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 disabled:opacity-50">
          Обновить
        </button>
      </div>

      {err ? <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-red-600">{err}</div> : null}

      <div className="mt-3 grid gap-3">
        {rooms.map((r) => (
          <Link
            key={r.id}
            href={`/specialist/rooms/${encodeURIComponent(r.id)}`}
            className="rounded-2xl border bg-white p-4 shadow-sm hover:shadow"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{r.name}</div>
                <div className="mt-1 text-xs text-zinc-500">
                  {r.is_active ? "Активна" : "Не активна"} · {new Date(r.created_at).toLocaleString()}
                </div>
              </div>
              <div className="text-xs text-zinc-500">Открыть</div>
            </div>
          </Link>
        ))}
        {rooms.length === 0 && !loading ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-600">Пока нет комнат.</div>
        ) : null}
      </div>
    </Layout>
  );
}
