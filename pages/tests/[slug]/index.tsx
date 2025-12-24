import Link from "next/link";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { ForcedPairTestV1 } from "@/lib/testTypes";

export default function TestDetail({ test }: { test: ForcedPairTestV1 }) {
  return (
    <Layout title={test.title}>
      {test.description ? <p className="mb-4 text-zinc-700">{test.description}</p> : null}

      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-zinc-600">Формат: выбрать 1 из 2 утверждений в каждой паре.</div>
        <div className="mt-2 text-sm text-zinc-600">Вопросов: {test.questions.length}</div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/tests/${test.slug}/take`}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Начать тест
          </Link>
          <Link
            href="/admin/import"
            className="rounded-xl border bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Импорт другого теста
          </Link>
        </div>
      </div>
    </Layout>
  );
}

export async function getServerSideProps({ params }: { params: { slug: string } }) {
  const test = await getTestBySlug(params.slug);
  if (!test) return { notFound: true };
  return { props: { test } };
}
