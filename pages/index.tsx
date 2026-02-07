import Link from "next/link";
import { Layout } from "@/components/Layout";
import { getAllTests } from "@/lib/loadTests";
import type { AnyTest } from "@/lib/testTypes";

export default function Home({ tests }: { tests: AnyTest[] }) {
  return (
    <Layout title="Каталог тестов">
      <div className="grid gap-3">
        {tests.map((t) => (
          <div key={t.slug} className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/tests/${t.slug}`} className="block text-lg font-semibold hover:underline">
                  {t.title}
                </Link>
                <div className="mt-2 text-xs text-zinc-500">{t.questions.length} вопросов</div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                <Link href={`/tests/${t.slug}/take`} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white">
                  Начать
                </Link>
              </div>
            </div>
          </div>
        ))}

        {tests.length === 0 ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-zinc-600">
            Пока нет опубликованных тестов.
            <div className="mt-2">Скоро появятся.</div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}

export async function getServerSideProps() {
  const tests = await getAllTests();
  return { props: { tests } };
}
