import { Layout } from "@/components/Layout";

export default function CertificatesPage() {
  return (
    <Layout title="Документы">
      <div className="card">
        <div className="text-lg font-semibold">Документы</div>
        <div className="mt-1 text-sm text-zinc-700">
          На текущем этапе мы не показываем фотографии сертификатов. В каталоге тестов для 16PF-A используется пометка
          <b> «Сертифицировано»</b>.
        </div>
      </div>
    </Layout>
  );
}
