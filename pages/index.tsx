import Link from "next/link";
import { Layout } from "@/components/Layout";
import { getAllTests } from "@/lib/loadTests";
import type { AnyTest } from "@/lib/testTypes";

export default function Home({ tests }: { tests: AnyTest[] }) {
  return (
    <Layout title="Каталог тестов">
      <div className="grid gap-3">
        {tests.map((t) => (
          <Link
            key={t.slug}
            href={`/tests/${t.slug}`}
            className="rounded-2xl border bg-white p-4 shadow-sm transition hover:shadow"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{t.title}</div>
                {t.description ? (
                  <div className="mt-1 text-sm text-zinc-600">{t.description}</div>
                ) : null}
              </div>
              <div className="text-xs text-zinc-500">{t.questions.length} вопросов</div>
            </div>
          </Link>
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
