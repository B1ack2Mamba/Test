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
        <div className="card">
          <div className="text-sm font-semibold">Раздел временно скрыт</div>
          <div className="mt-1 text-sm text-slate-700">Сейчас доступна только работа с тестами в комнатах.</div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/training" className="btn btn-secondary">
              На главную
            </Link>
            <Link href="/training" className="btn btn-secondary">
              Комнаты
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  return <WalletFullNoSSR />;
}
