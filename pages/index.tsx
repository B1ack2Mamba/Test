import type { GetServerSideProps } from "next";

// Главную страницу прячем полностью: всегда уводим в раздел комнат.
export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: "/auth?next=%2Ftraining",
      permanent: false,
    },
  };
};

export default function Home() {
  return null;
}
