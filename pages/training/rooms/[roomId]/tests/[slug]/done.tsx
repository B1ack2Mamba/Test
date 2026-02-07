import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";

export default function TrainingDone() {
  const router = useRouter();
  const roomId = String(router.query.roomId || "");
  const attemptId = String(router.query.attempt || "");

  return (
    <Layout title="Тест завершён">
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-lg font-semibold">Готово ✅</div>
        <div className="mt-1 text-sm text-zinc-700">Результаты отправлены специалисту в комнате.</div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/training/rooms/${encodeURIComponent(roomId)}`}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Назад в комнату
          </Link>

          {attemptId ? (
            <Link
              href={`/training/results?attempt=${encodeURIComponent(attemptId)}`}
              className="rounded-xl border bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Открыть разбор
            </Link>
          ) : null}
        </div>
      </div>
    </Layout>
  );
}
