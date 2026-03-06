import Image from "next/image";
import { Layout } from "@/components/Layout";

export default function CertificatesPage() {
  return (
    <Layout title="Документы">
      <div className="card">
        <div className="text-lg font-semibold">Документы</div>
        <div className="mt-1 text-sm text-zinc-600">
          Для удобства участника и тренера здесь размещены подтверждающие документы, которые вы используете на тренингах.
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="card">
          <div className="text-sm font-semibold">Свидетельство</div>
          <div className="mt-2 overflow-hidden rounded-2xl border bg-white">
            <Image
              src="/certificates/cogito-svidetelstvo.png"
              alt="Свидетельство"
              width={1280}
              height={964}
              className="h-auto w-full"
              priority
            />
          </div>
        </div>

        <div className="card">
          <div className="text-sm font-semibold">Сертификат</div>
          <div className="mt-2 overflow-hidden rounded-2xl border bg-white">
            <Image
              src="/certificates/cogito-sertifikat.png"
              alt="Сертификат"
              width={2048}
              height={1542}
              className="h-auto w-full"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}
