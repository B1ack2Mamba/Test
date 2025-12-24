import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Layout } from "@/components/Layout";
import { getTestBySlug } from "@/lib/loadTests";
import type { ForcedPairTestV1, Tag } from "@/lib/testTypes";
import { scoreForcedPair } from "@/lib/score";

function storageKey(slug: string) {
  return `attempt:${slug}:answers`;
}
function resultKey(slug: string) {
  return `attempt:${slug}:result`;
}

export default function TakeTest({ test }: { test: ForcedPairTestV1 }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<(Tag | null)[]>(() => {
    if (typeof window === "undefined") return Array(test.questions.length).fill(null);
    const raw = window.sessionStorage.getItem(storageKey(test.slug));
    if (!raw) return Array(test.questions.length).fill(null);
    try {
      const parsed = JSON.parse(raw) as (Tag | null)[];
      if (Array.isArray(parsed) && parsed.length === test.questions.length) return parsed;
      return Array(test.questions.length).fill(null);
    } catch {
      return Array(test.questions.length).fill(null);
    }
  });

  const answeredCount = useMemo(() => answers.filter(Boolean).length, [answers]);
  const canSubmit = answeredCount === test.questions.length;

  const pick = (idx: number, tag: Tag) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = tag;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(storageKey(test.slug), JSON.stringify(next));
      }
      return next;
    });
  };

  const submit = () => {
    const tags = answers.filter(Boolean) as Tag[];
    const res = scoreForcedPair(test, tags);
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(resultKey(test.slug), JSON.stringify(res));
      window.sessionStorage.removeItem(storageKey(test.slug));
    }
    router.push(`/tests/${test.slug}/result`);
  };

  return (
    <Layout title={test.title}>
      <div className="mb-4 rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-zinc-600">
            Прогресс: <span className="font-medium text-zinc-900">{answeredCount}/{test.questions.length}</span>
          </div>
          <Link href={`/tests/${test.slug}`} className="text-sm text-zinc-600 hover:text-zinc-900">
            ← к описанию
          </Link>
        </div>

        <div className="mt-3 h-2 w-full rounded-full bg-zinc-100">
          <div
            className="h-2 rounded-full bg-zinc-900 transition-all"
            style={{ width: `${Math.round((answeredCount / test.questions.length) * 100)}%` }}
          />
        </div>
      </div>

      <div className="grid gap-3">
        {test.questions.map((q, idx) => {
          const chosen = answers[idx];
          const [o1, o2] = q.options;
          return (
            <div key={q.order} className="rounded-2xl border bg-white p-4">
              <div className="mb-3 text-sm font-medium text-zinc-900">Пара {q.order}</div>
              <div className="grid gap-2 md:grid-cols-2">
                <button
                  onClick={() => pick(idx, o1.tag)}
                  className={[
                    "rounded-xl border p-3 text-left text-sm transition",
                    chosen === o1.tag ? "border-zinc-900 bg-zinc-50" : "hover:bg-zinc-50",
                  ].join(" ")}
                >
                  <div className="text-xs text-zinc-500">({o1.tag})</div>
                  <div className="mt-1">{o1.text}</div>
                </button>

                <button
                  onClick={() => pick(idx, o2.tag)}
                  className={[
                    "rounded-xl border p-3 text-left text-sm transition",
                    chosen === o2.tag ? "border-zinc-900 bg-zinc-50" : "hover:bg-zinc-50",
                  ].join(" ")}
                >
                  <div className="text-xs text-zinc-500">({o2.tag})</div>
                  <div className="mt-1">{o2.text}</div>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4">
        <div className="text-sm text-zinc-600">Готово? Для результата нужно ответить на все пары.</div>
        <button
          disabled={!canSubmit}
          onClick={submit}
          className={[
            "rounded-xl px-4 py-2 text-sm font-medium text-white",
            canSubmit ? "bg-zinc-900 hover:bg-zinc-800" : "cursor-not-allowed bg-zinc-300",
          ].join(" ")}
        >
          Показать результат
        </button>
      </div>
    </Layout>
  );
}

export async function getServerSideProps({ params }: { params: { slug: string } }) {
  const test = await getTestBySlug(params.slug);
  if (!test) return { notFound: true };
  return { props: { test } };
}
