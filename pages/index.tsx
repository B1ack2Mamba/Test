import Link from "next/link";
import { Layout } from "@/components/Layout";

export default function Home() {
  return (
    <Layout title="Главная">
      <div className="grid gap-3">
        <div className="card text-sm text-zinc-700">
          Тесты доступны только через комнаты тренинга (чтобы никто случайно не проходил их на главной странице).
        </div>

        <div className="card">
          <div className="text-sm font-semibold">Куда перейти</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/training" className="btn btn-primary">
              Комнаты
            </Link>
            <Link href="/specialist" className="btn btn-secondary">
              Кабинет специалиста
            </Link>
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            Если вам выдали пароль — зайдите в комнату, и там появится список тестов.
          </div>
        </div>
      </div>
    </Layout>
  );
}
