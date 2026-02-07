import { useMemo, useState } from "react";
import { Layout } from "@/components/Layout";
import type { Tag } from "@/lib/testTypes";
import { ForcedPairTestSchema, type ImportedForcedPairTest } from "@/lib/testSchema";
import { useSession } from "@/lib/useSession";
import { isAdminEmail, ADMIN_EMAIL } from "@/lib/admin";

function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportPage() {
  const { user, session, loading, envOk } = useSession();
  const [raw, setRaw] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [test, setTest] = useState<ImportedForcedPairTest | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");

  const stats = useMemo(() => {
    if (!test) return null;
    const tags = new Set<Tag>();
    for (const q of test.questions) {
      tags.add(q.options[0].tag as Tag);
      tags.add(q.options[1].tag as Tag);
    }
    return {
      questions: test.questions.length,
      tagsUsed: Array.from(tags).sort().join(", "),
    };
  }, [test]);

  const parse = () => {
    setError("");
    setUploadStatus("");
    setTest(null);
    try {
      const obj = JSON.parse(raw);
      const parsed = ForcedPairTestSchema.parse(obj);
      setTest(parsed);
    } catch (e: any) {
      setError(e?.message ?? "Ошибка парсинга JSON");
    }
  };

  const uploadToSupabase = async () => {
    if (!test) return;
    setUploadStatus("⏳ Загружаю в Supabase...");
    try {
      const accessToken = session?.access_token;
      if (!accessToken) {
        setUploadStatus("❌ Нужен вход");
        return;
      }
      const r = await fetch("/api/admin/upsert-test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ test }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setUploadStatus(`❌ ${j?.error ?? "Ошибка"}`);
        return;
      }
      setUploadStatus(`✅ Загружено: ${j.slug}`);
    } catch (e: any) {
      setUploadStatus(`❌ ${e?.message ?? "Ошибка"}`);
    }
  };

  if (!envOk) {
    return (
      <Layout title="Импорт теста (JSON)">
        <div className="card text-sm text-zinc-600">
          Supabase не настроен. Добавь переменные из <code className="rounded bg-white/60 px-1">.env.example</code>.
        </div>
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout title="Импорт теста (JSON)">
        <div className="card text-sm text-zinc-600">Загрузка…</div>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout title="Импорт теста (JSON)">
        <div className="card text-sm text-zinc-600">
          Нужен вход. Перейди в <a className="underline" href="/auth">/auth</a>.
        </div>
      </Layout>
    );
  }

  if (!isAdminEmail(user.email)) {
    return (
      <Layout title="Импорт теста (JSON)">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Доступ запрещён. Админ: <span className="font-mono">{ADMIN_EMAIL}</span>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Импорт теста (JSON)">
      <div className="card">
        <div className="text-sm text-zinc-600">
          Вставь JSON теста (формат <code className="rounded bg-white/60 px-1">forced_pair_v1</code> или
          <code className="ml-1 rounded bg-white/60 px-1">forced_pair</code>) и нажми “Проверить”.
          <div className="mt-2">
            Загрузи через кнопку ниже (доступ только для админа по email).
          </div>
        </div>

        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder='{"slug":"my-test","title":"...","type":"forced_pair_v1",...}'
          className="mt-3 h-64 textarea font-mono text-xs"
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={parse}
            className="btn btn-primary"
          >
            Проверить
          </button>

          <button
            onClick={() => {
              const template: ImportedForcedPairTest = {
                slug: "my-test",
                title: "Название теста",
                description: "Короткое описание",
                type: "forced_pair_v1",
                questions: [
                  {
                    order: 1,
                    options: [
                      { tag: "A", text: "Утверждение 1" },
                      { tag: "B", text: "Утверждение 2" },
                    ],
                  },
                ],
                scoring: {
                  tags: ["A", "B", "C", "D", "E"],
                  tag_to_style: {
                    A: "Стиль A",
                    B: "Стиль B",
                    C: "Стиль C",
                    D: "Стиль D",
                    E: "Стиль E",
                  },
                  thresholds_percent: { strong_gte: 70, weak_lte: 30 },
                },
              };
              downloadJson("template-test.json", template);
            }}
            className="btn btn-secondary"
          >
            Скачать шаблон
          </button>

          {test ? (
            <button
              onClick={() => {
                // Local fallback JSON must NOT include paid interpretation.
                const publicTest: any = { ...test };
                delete publicTest.interpretation;
                delete publicTest.pricing;
                downloadJson(`${test.slug}.json`, publicTest);
              }}
              className="btn btn-secondary"
            >
              Скачать {test.slug}.json
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        ) : null}

        {test && stats ? (
          <div className="mt-4 card-soft p-3 text-sm">
            <div className="font-medium">✅ Валидно</div>
            <div className="mt-1 text-zinc-700">
              slug: <span className="font-mono">{test.slug}</span>
            </div>
            <div className="text-zinc-700">вопросов: {stats.questions}</div>
            <div className="text-zinc-700">используемые теги: {stats.tagsUsed}</div>

            <div className="mt-4 card-soft p-3">
              <div className="text-sm font-medium">Загрузить в Supabase</div>
              <div className="mt-1 text-xs text-zinc-600">
                Доступ только администратору (по email). На сервере должен быть прописан
                <code className="ml-1 rounded bg-white/60 px-1">SUPABASE_SERVICE_ROLE_KEY</code>.
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  disabled={!user || !isAdminEmail(user.email)}
                  onClick={uploadToSupabase}
                  className="btn btn-primary disabled:opacity-50"
                >
                  Загрузить
                </button>
              </div>

              {uploadStatus ? (
                <div className="mt-2 text-xs text-zinc-700">{uploadStatus}</div>
              ) : null}
            </div>

            <div className="mt-3 text-xs text-zinc-600">
              Локальный вариант требует перезапуска dev-сервера. Supabase вариант — сразу доступен всем.
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
