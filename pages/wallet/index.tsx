import dynamic from "next/dynamic";
import Link from "next/link";
import { Layout } from "@/components/Layout";
import { PAYMENTS_UI_ENABLED } from "@/lib/payments";

const WalletFullNoSSR = dynamic(() => import("@/components/WalletFull").then((m) => m.default), {
  ssr: false,
});

export default function WalletPage() {
  if (!PAYMENTS_UI_ENABLED) {
    return (
      <Layout title="Кошелёк">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-sm font-semibold">Раздел временно скрыт</div>
          <div className="mt-1 text-sm text-zinc-700">Сейчас доступна только работа с тестами и тренинг-комнатами.</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/" className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-zinc-50">
              На главную
            </Link>
            <Link href="/training" className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-zinc-50">
              Тренинги
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return <WalletFullNoSSR />;
}
